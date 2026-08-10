# This file is part of Koha.
#
# Copyright (C) 2025  Duke Chijimaka Jonathan
#
# Koha is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# Koha is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Koha; if not, see <http://www.gnu.org/licenses>.

package Koha::Plugin::Cataloging::AutoPunctuation::Rules;

use Modern::Perl;
use utf8;
use JSON qw(to_json from_json);
use Try::Tiny;
use Scalar::Util qw(looks_like_number);

# ─── Rule pack loading ───────────────────────────────────────────────

sub _rules_pack_path {
    my ($self) = @_;
    return $self->get_plugin_dir() . '/rules/isbd_baseline.json';
}

sub _load_rules_pack {
    my ($self) = @_;
    my $content = $self->_read_file('rules/isbd_baseline.json');
    return {} unless $content;
    my $pack = {};
    try { $pack = from_json($content); } catch { $pack = {}; };
    $pack->{rules} ||= [];
    return $pack;
}

# ─── Regex safety ────────────────────────────────────────────────────

sub _regex_too_complex {
    my ( $self, $pattern ) = @_;
    return 0 unless defined $pattern;
    return 1 if length($pattern) > 120;
    return 1
      if $pattern =~
      /\([^)]*(?:\+|\*|\{\d+,?\d*\})[^)]*\)(?:\+|\*|\?|\{\d+,?\d*\})/;
    return 1 if $pattern =~ /\.\*(?:\+|\*)/;
    return 0;
}

sub _validate_regex_pattern {
    my ( $self, $pattern, $label ) = @_;
    return '' unless defined $pattern && $pattern ne '';
    return "$label regex is too long or complex."
      if _regex_too_complex( $self, $pattern );
    my $ok = 0;
    try { qr/$pattern/; $ok = 1; } catch { $ok = 0; };
    return $ok ? '' : "$label regex is invalid.";
}

sub _safe_regex {
    my ( $self, $pattern ) = @_;
    return undef unless defined $pattern && $pattern ne '';
    return undef if _regex_too_complex( $self, $pattern );
    my $compiled;
    try { $compiled = qr/$pattern/; } catch { $compiled = undef; };
    return $compiled;
}

# ─── Custom rule validation ──────────────────────────────────────────

sub _validate_custom_rules {
    my ( $self, $custom_rules ) = @_;
    my @errors;
    return \@errors unless $custom_rules;
    if ( ref $custom_rules ne 'HASH' ) {
        push @errors, 'Custom rules must be a JSON object.';
        return \@errors;
    }
    return \@errors unless %{$custom_rules};

    if ( exists $custom_rules->{rules}
        && ref $custom_rules->{rules} ne 'ARRAY' )
    {
        push @errors, 'Custom rules "rules" must be an array.';
        return \@errors;
    }
    unless ( $custom_rules->{rules} && ref $custom_rules->{rules} eq 'ARRAY' ) {
        push @errors, 'Custom rules must be empty or include a rules array.';
        return \@errors;
    }

    my %valid_check_types = map { $_ => 1 } qw(
      punctuation separator no_terminal_punctuation spacing normalize_punctuation fixed_field
    );
    my %valid_severities = map { $_ => 1 } qw(ERROR WARNING INFO);
    my %valid_suffix_modes =
      map { $_ => 1 } qw(always conditional_following when_following when_last);
    my %valid_prefix_modes = map { $_ => 1 }
      qw(always conditional_preceding when_preceding when_first);
    my %valid_repeat    = map { $_ => 1 } qw(all first_only last_only);
    my $is_string_array = sub {
        my ($v) = @_;
        return 0 unless ref $v eq 'ARRAY';
        return scalar( grep { !defined $_ || ref $_ } @{$v} ) ? 0 : 1;
    };

    for my $rule ( @{ $custom_rules->{rules} } ) {
        unless ( ref $rule eq 'HASH' ) {
            push @errors, 'Each rule must be an object.';
            next;
        }
        my $id = $rule->{id} || '(missing id)';
        push @errors, "Rule $id must include tag or tag_pattern."
          unless $rule->{tag} || $rule->{tag_pattern};
        push @errors, "Rule $id must include subfields or subfield_pattern."
          unless $rule->{subfields} || $rule->{subfield_pattern};
        push @errors, "Rule $id must include checks array."
          unless $rule->{checks} && ref $rule->{checks} eq 'ARRAY';

        for my $pattern_key (qw(tag_pattern subfield_pattern)) {
            if ( $rule->{$pattern_key} ) {
                my $msg = _validate_regex_pattern( $self, $rule->{$pattern_key},
                    "Rule $id $pattern_key" );
                push @errors, $msg if $msg;
            }
        }
        if ( $rule->{subfields} && ref $rule->{subfields} ne 'ARRAY' ) {
            push @errors, "Rule $id subfields must be an array.";
        }
        for my $list_key (
            qw(requires_subfields forbids_subfields requires_following_subfields forbids_following_subfields requires_preceding_subfields forbids_preceding_subfields when_following_subfields when_preceding_subfields end_in end_not_in)
          )
        {
            if ( exists $rule->{$list_key}
                && !$is_string_array->( $rule->{$list_key} ) )
            {
                push @errors, "Rule $id $list_key must be an array of strings.";
            }
        }
        for my $key (qw(next_subfield_is previous_subfield_is)) {
            if ( exists $rule->{$key} ) {
                my $v = $rule->{$key};
                if ( ref $v && !$is_string_array->($v) ) {
                    push @errors,
                      "Rule $id $key must be a string or array of strings.";
                }
            }
        }
        if ( $rule->{repeat_policy}
            && !$valid_repeat{ $rule->{repeat_policy} } )
        {
            push @errors,
"Rule $id repeat_policy must be one of: all, first_only, last_only.";
        }
        next unless $rule->{checks} && ref $rule->{checks} eq 'ARRAY';
        for my $idx ( 0 .. $#{ $rule->{checks} } ) {
            my $check = $rule->{checks}[$idx];
            unless ( ref $check eq 'HASH' ) {
                push @errors, "Rule $id check #$idx must be an object.";
                next;
            }
            my $type = $check->{type} || '';
            if ( !$type || !$valid_check_types{$type} ) {
                push @errors,
                  "Rule $id check #$idx has unsupported type \"$type\".";
            }
            push @errors,
              "Rule $id check #$idx severity must be ERROR, WARNING, or INFO."
              if $check->{severity} && !$valid_severities{ $check->{severity} };
            push @errors, "Rule $id check #$idx suffix_mode is invalid."
              if $check->{suffix_mode}
              && !$valid_suffix_modes{ $check->{suffix_mode} };
            push @errors, "Rule $id check #$idx prefix_mode is invalid."
              if $check->{prefix_mode}
              && !$valid_prefix_modes{ $check->{prefix_mode} };
            for my $list_key (
                qw(when_following_subfields when_preceding_subfields end_in end_not_in)
              )
            {
                if ( exists $check->{$list_key}
                    && !$is_string_array->( $check->{$list_key} ) )
                {
                    push @errors,
"Rule $id check #$idx $list_key must be an array of strings.";
                }
            }
        }
    }
    return \@errors;
}

# ─── Rule merging ────────────────────────────────────────────────────

sub _merge_rules_pack {
    my ( $self, $settings ) = @_;
    my $pack   = _load_rules_pack( $self, );
    my $custom = {};
    try { $custom = from_json( $settings->{custom_rules} || '{}' ); }
    catch { $custom = {}; };
    my @rules = @{ $pack->{rules} || [] };
    if ( $custom->{rules} && ref $custom->{rules} eq 'ARRAY' ) {
        push @rules, @{ $custom->{rules} };
    }
    $pack->{rules} = \@rules;
    return $pack;
}

# ─── Indicator matching ──────────────────────────────────────────────

sub _indicator_match {
    my ( $value, $rule_value ) = @_;
    return 1 unless defined $rule_value && length $rule_value;
    return 1 if $rule_value eq '*';
    if ( ref $rule_value eq 'ARRAY' ) {
        return scalar grep { defined $_ && $_ eq $value } @{$rule_value};
    }
    return $rule_value eq $value;
}

# ─── Rule matching ───────────────────────────────────────────────────

sub _rules_match {
    my ( $self, $rule, $tag, $subfield, $ind1, $ind2 ) = @_;
    return 0 unless $rule;
    if ( $rule->{tag} ) {
        return 0 unless $rule->{tag} eq $tag;
    }
    if ( $rule->{tag_pattern} ) {
        my $compiled = _safe_regex( $self, $rule->{tag_pattern} );
        return 0 unless $compiled && $tag =~ $compiled;
    }
    return 0 unless _indicator_match( $ind1 // '', $rule->{ind1} );
    return 0 unless _indicator_match( $ind2 // '', $rule->{ind2} );
    if ( $rule->{subfields} && ref $rule->{subfields} eq 'ARRAY' ) {
        my $matched =
          scalar grep { lc($_) eq lc($subfield) } @{ $rule->{subfields} };
        return $matched ? 1 : 0;
    }
    if ( $rule->{subfield_pattern} ) {
        my $compiled = _safe_regex( $self, $rule->{subfield_pattern} );
        return 0 unless $compiled;
        return $subfield =~ $compiled ? 1 : 0;
    }
    return 1;
}

sub _rules_match_for_coverage {
    my ( $self, $rule, $tag, $subfield ) = @_;
    return 0 unless $rule;
    if ( $rule->{tag} ) {
        return 0 unless $rule->{tag} eq $tag;
    }
    if ( $rule->{tag_pattern} ) {
        my $compiled = _safe_regex( $self, $rule->{tag_pattern} );
        return 0 unless $compiled && $tag =~ $compiled;
    }
    if ( $rule->{subfields} && ref $rule->{subfields} eq 'ARRAY' ) {
        my $matched =
          scalar grep { lc($_) eq lc($subfield) } @{ $rule->{subfields} };
        return $matched ? 1 : 0;
    }
    if ( $rule->{subfield_pattern} ) {
        my $compiled = _safe_regex( $self, $rule->{subfield_pattern} );
        return 0 unless $compiled;
        return $subfield =~ $compiled ? 1 : 0;
    }
    return 1;
}

# ─── Field/subfield helpers ──────────────────────────────────────────

sub _active_subfield {
    my ($sub) = @_;
    return $sub
      && $sub->{code}
      && defined $sub->{value}
      && $sub->{value} =~ /\S/ ? 1 : 0;
}

sub _semantic_relation_exists {
    my ( $self, $field, $index, $code, $direction ) = @_;
    return 0 unless $field && ref $field->{subfields} eq 'ARRAY';
    my $subs         = $field->{subfields};
    my $wanted       = lc( $code // '' );
    my $current      = $subs->[$index] || {};
    my $current_code = lc( $current->{code} // '' );
    if ( $wanted ne $current_code ) {
        my $relationship_model =
          $field->{_relationship_model}
          && ref $field->{_relationship_model} eq 'HASH'
          ? $field->{_relationship_model}
          : {};
        my $model =
          $relationship_model->{subfields}
          && ref $relationship_model->{subfields} eq 'HASH'
          ? $relationship_model->{subfields}
          : {};
        my $current_meta = $model->{$current_code};
        my $wanted_meta  = $model->{$wanted};
        if (   $current_meta
            && $wanted_meta
            && defined $current_meta->{canonical_position}
            && defined $wanted_meta->{canonical_position} )
        {
            my $ordered = $direction eq 'preceding'
              ? $wanted_meta->{canonical_position} <
              $current_meta->{canonical_position}
              : $wanted_meta->{canonical_position} >
              $current_meta->{canonical_position};
            return 0 unless $ordered;
            return scalar grep {
                _active_subfield($_) && lc( $_->{code} ) eq $wanted
            } @{$subs};
        }
        # Custom and legacy rules without a declared relationship model keep
        # their historical physical-neighbour semantics.
    }
    my $start = $direction eq 'preceding' ? $index - 1 : $index + 1;
    my $step  = $direction eq 'preceding' ? -1         : 1;
    for ( my $i = $start ; $i >= 0 && $i <= $#$subs ; $i += $step ) {
        my $sub = $subs->[$i];
        return 1
          if _active_subfield($sub) && lc( $sub->{code} ) eq $wanted;
    }
    return 0;
}

sub _select_semantic_relative {
    my ( $self, $field, $index, $codes, $direction ) = @_;
    return undef unless $codes && ref $codes eq 'ARRAY';
    my $selected;
    my @ordered = $direction eq 'preceding' ? @{$codes} : reverse @{$codes};
    for my $code (@ordered) {
        next
          unless _semantic_relation_exists( $self, $field, $index, $code,
            $direction );
        my $wanted       = lc( $code // '' );
        my $current_code = lc( $field->{subfields}[$index]{code} // '' );
        my @candidates;
        for my $i ( 0 .. $#{ $field->{subfields} } ) {
            my $sub = $field->{subfields}[$i];
            next unless _active_subfield($sub) && lc( $sub->{code} ) eq $wanted;
            next
              if $wanted eq $current_code
              && ( $direction eq 'preceding' ? $i >= $index : $i <= $index );
            push @candidates, $sub;
        }
        next unless @candidates;
        $selected =
          $direction eq 'preceding' ? $candidates[-1] : $candidates[0];
    }
    return $selected;
}

sub _field_has_subfield {
    my ( $self, $field, $code, $start_index ) = @_;
    return 0 unless $field && $field->{subfields} && $code;
    my $subs  = $field->{subfields} || [];
    my $start = defined $start_index ? $start_index : 0;
    for my $i ( $start .. $#$subs ) {
        my $sub = $subs->[$i];
        next
          unless $sub->{code} && defined $sub->{value} && $sub->{value} =~ /\S/;
        return 1 if lc( $sub->{code} ) eq lc($code);
    }
    return 0;
}

sub _field_has_subfield_after {
    my ( $self, $field, $index, $code ) = @_;
    return _semantic_relation_exists( $self, $field, $index, $code,
        'following' );
}

sub _field_has_subfield_before {
    my ( $self, $field, $index, $code ) = @_;
    return _semantic_relation_exists( $self, $field, $index, $code,
        'preceding' );
}

sub _repeat_policy_allows {
    my ( $self, $field, $subfield, $index, $policy ) = @_;
    $policy ||= 'all';
    return 1 if $policy eq 'all';
    my $code = $subfield->{code}   || '';
    my $subs = $field->{subfields} || [];
    my @indices = grep {
        _active_subfield( $subs->[$_] )
          && lc( ( $subs->[$_]{code} || '' ) ) eq lc($code)
    } ( 0 .. $#$subs );
    return 1 unless @indices;
    return $index == $indices[0]  if $policy eq 'first_only';
    return $index == $indices[-1] if $policy eq 'last_only';
    return 1;
}

sub _rule_specificity {
    my ( $self, $rule ) = @_;
    return 0 unless $rule && ref $rule eq 'HASH';
    my $score = 0;
    $score += $rule->{tag} ? 8 : ( $rule->{tag_pattern} ? 3 : 0 );
    $score +=
      ( $rule->{subfields} && ref $rule->{subfields} eq 'ARRAY' )
      ? 4
      : ( $rule->{subfield_pattern} ? 1 : 0 );
    $score += 2 if defined $rule->{ind1} && $rule->{ind1} ne '';
    $score += 2 if defined $rule->{ind2} && $rule->{ind2} ne '';
    $score += 1
      if $rule->{requires_subfields}
      && ref $rule->{requires_subfields} eq 'ARRAY';
    $score += 1
      if $rule->{forbids_subfields}
      && ref $rule->{forbids_subfields} eq 'ARRAY';
    $score += 1
      if $rule->{requires_following_subfields}
      && ref $rule->{requires_following_subfields} eq 'ARRAY';
    $score += 1
      if $rule->{forbids_following_subfields}
      && ref $rule->{forbids_following_subfields} eq 'ARRAY';
    $score += 1
      if $rule->{requires_preceding_subfields}
      && ref $rule->{requires_preceding_subfields} eq 'ARRAY';
    $score += 1
      if $rule->{forbids_preceding_subfields}
      && ref $rule->{forbids_preceding_subfields} eq 'ARRAY';
    return $score;
}

sub _filter_matched_rules {
    my ( $self, @rules ) = @_;
    return @rules if @rules <= 1;
    my @active = grep { !$_->{only_when_no_other_rule} } @rules;
    @active = @rules unless @active;
    my $max_score = 0;
    for my $rule (@active) {
        my $score = _rule_specificity( $self, $rule );
        $max_score = $score if $score > $max_score;
    }
    return grep {
        $_->{always_apply}
          || _rule_specificity( $self, $_ ) == $max_score
    } @active;
}

sub _rule_applies_to_subfield {
    my ( $self, $rule, $field, $subfield, $index ) = @_;
    return 0
      unless _rules_match( $self, $rule, $field->{tag}, $subfield->{code},
        $field->{ind1}, $field->{ind2} );
    if ( $rule->{requires_subfields}
        && ref $rule->{requires_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{requires_subfields} } ) {
            return 0 unless _field_has_subfield( $self, $field, $code );
        }
    }
    if ( $rule->{forbids_subfields}
        && ref $rule->{forbids_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{forbids_subfields} } ) {
            return 0 if _field_has_subfield( $self, $field, $code );
        }
    }
    if ( $rule->{requires_following_subfields}
        && ref $rule->{requires_following_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{requires_following_subfields} } ) {
            return 0
              unless _field_has_subfield_after( $self, $field, $index, $code );
        }
    }
    if ( $rule->{forbids_following_subfields}
        && ref $rule->{forbids_following_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{forbids_following_subfields} } ) {
            return 0
              if _field_has_subfield_after( $self, $field, $index, $code );
        }
    }
    if ( $rule->{requires_preceding_subfields}
        && ref $rule->{requires_preceding_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{requires_preceding_subfields} } ) {
            return 0
              unless _field_has_subfield_before( $self, $field, $index, $code );
        }
    }
    if ( $rule->{forbids_preceding_subfields}
        && ref $rule->{forbids_preceding_subfields} eq 'ARRAY' )
    {
        for my $code ( @{ $rule->{forbids_preceding_subfields} } ) {
            return 0
              if _field_has_subfield_before( $self, $field, $index, $code );
        }
    }
    if ( $rule->{next_subfield_is} ) {
        my @allowed =
          ref $rule->{next_subfield_is} eq 'ARRAY'
          ? @{ $rule->{next_subfield_is} }
          : ( $rule->{next_subfield_is} );
        return 0
          unless scalar grep {
            _semantic_relation_exists( $self, $field, $index, $_,
                'following' )
          } @allowed;
    }
    if ( $rule->{previous_subfield_is} ) {
        my @allowed =
          ref $rule->{previous_subfield_is} eq 'ARRAY'
          ? @{ $rule->{previous_subfield_is} }
          : ( $rule->{previous_subfield_is} );
        return 0
          unless scalar grep {
            _semantic_relation_exists( $self, $field, $index, $_,
                'preceding' )
          } @allowed;
    }
    return 0
      unless _repeat_policy_allows( $self, $field, $subfield, $index,
        $rule->{repeat_policy} || 'all' );
    return 1;
}

# ─── Exclusion/coverage helpers ──────────────────────────────────────

sub _is_local_tag {
    my ($tag) = @_;
    return 0 unless defined $tag;
    return $tag =~ /^9\d\d$/ ? 1 : 0;
}

sub _is_excluded_field {
    my ( $self, $settings, $tag, $subfield ) = @_;
    return 1 if !$settings->{enable_local_fields} && _is_local_tag($tag);
    if (   $settings->{enable_local_fields}
        && $settings->{local_fields_allowlist} )
    {
        my @allow   = split( /\s*,\s*/, $settings->{local_fields_allowlist} );
        my $allowed = scalar grep {
            my $entry = $_;
            if ( $entry =~ /^9XX$/i )    { return _is_local_tag($tag); }
            if ( $entry =~ /^(\d)XX$/i ) { return $tag =~ /^$1\d\d$/; }
            if ( $entry =~ /^\d{3}[a-z0-9]$/i ) {
                return lc($entry) eq lc( $tag . $subfield );
            }
            if ( $entry =~ /^\d{3}$/ ) { return $entry eq $tag; }
            return 0;
        } @allow;
        return 1 unless $allowed;
    }
    my @exclusions = split( /\s*,\s*/, $settings->{excluded_tags} || '' );
    return scalar grep {
        my $entry = $_;
        if ( $entry =~ /^(\d)XX$/i ) { return $tag =~ /^$1\d\d$/; }
        if ( $entry =~ /^\d{3}[a-z0-9]$/i ) {
            return lc($entry) eq lc( $tag . $subfield );
        }
        if ( $entry =~ /^\d{3}$/ ) { return $entry eq $tag; }
        if ( $entry =~ /^9XX$/i )  { return _is_local_tag($tag); }
        return 0;
    } @exclusions;
}

sub _is_field_covered {
    my ( $self, $pack, $tag, $subfield, $ind1, $ind2 ) = @_;
    my @rules = @{ $pack->{rules} || [] };
    for my $rule (@rules) {
        return 1 if _rules_match( $self, $rule, $tag, $subfield, $ind1, $ind2 );
    }
    return 0;
}

# ─── Coverage report ─────────────────────────────────────────────────

sub _build_coverage_report {
    my ( $self, $settings ) = @_;
    my $pack       = _merge_rules_pack( $self, $settings );
    my @rules      = @{ $pack->{rules} || [] };
    my $dbh        = C4::Context->dbh;
    my $frameworks = $dbh->selectall_arrayref(
        "SELECT frameworkcode, frameworktext FROM biblio_framework",
        { Slice => {} } )
      || [];
    my @fw_list = @{$frameworks};
    push @fw_list, { frameworkcode => '', frameworktext => 'Default' }
      unless grep { ( ( $_->{frameworkcode} || '' ) eq '' ) } @fw_list;

    my @report;
    my @stubs;
    my %summary = ( covered => 0, excluded => 0, not_covered => 0, total => 0 );

    for my $fw (@fw_list) {
        next unless ref $fw eq 'HASH';
        my $code = defined $fw->{frameworkcode} ? $fw->{frameworkcode} : '';
        my $rows = $dbh->selectall_arrayref(
"SELECT tagfield, tagsubfield FROM marc_subfield_structure WHERE frameworkcode = ?",
            { Slice => {} },
            $code
        ) || [];
        my @fields;
        my %counts =
          ( total => 0, covered => 0, excluded => 0, not_covered => 0 );
        my %seen;
        for my $row ( @{$rows} ) {
            next unless ref $row eq 'HASH';
            my ( $tag, $sf ) = ( $row->{tagfield}, $row->{tagsubfield} );
            next unless $tag && $sf;
            my $key = lc( $tag . '$' . $sf );
            next if $seen{$key}++;
            my $excluded = _is_excluded_field( $self, $settings, $tag, $sf );
            my @matched =
              grep { _rules_match_for_coverage( $self, $_, $tag, $sf ) } @rules;
            my $status =
              $excluded ? 'excluded' : @matched ? 'covered' : 'not_covered';
            push @fields,
              {
                tag      => $tag,
                subfield => $sf,
                status   => $status,
                rule_ids => [ map { $_->{id} || '' } @matched ]
              };
            $counts{total}++;
            $counts{$status}++;
            $summary{total}++;
            $summary{$status}++;

            if ( $status eq 'not_covered' ) {
                push @stubs,
                  {
                    id        => "CUSTOM_${tag}${sf}",
                    tag       => $tag,
                    subfields => [$sf],
                    severity  => "INFO",
                    rationale => "Stub for local ISBD punctuation guidance.",
                    checks    => [
                        {
                            type        => "punctuation",
                            prefix      => "",
                            suffix      => "",
                            suffix_mode => "always",
                            severity    => "INFO",
                            message     =>
                              "Define ISBD punctuation for ${tag}\$${sf}."
                        }
                    ],
                    fixes => [
                        {
                            label => "Apply punctuation",
                            patch => [
                                {
                                    op             => "replace_subfield",
                                    value_template => "{{expected}}"
                                }
                            ]
                        }
                    ],
                    examples => [ { before => "", after => "" } ]
                  };
            }
        }
        push @report,
          {
            frameworkcode => $code,
            frameworktext => $fw->{frameworktext} || $code || 'Default',
            fields        => [ grep { ref $_ eq 'HASH' } @fields ],
            counts        => {
                total       => $counts{total},
                covered     => $counts{covered},
                excluded    => $counts{excluded},
                not_covered => $counts{not_covered}
            }
          };
    }
    return {
        report        => \@report,
        summary       => \%summary,
        stubs_json    => to_json( \@stubs ),
        rules_version => $pack->{version} || ''
    };
}

# ─── Punctuation helpers ─────────────────────────────────────────────

sub _strip_punct_space {
    my ( $self, $value ) = @_;
    my $text = $value // '';
    $text =~ s/[[:punct:]\s]+//g;
    return $text;
}

sub _punctuation_only_change {
    my ( $self, $original, $replacement ) = @_;
    return 0 unless defined $original && defined $replacement;
    my $allowed = qr/[\s.,:;\/=+\-\x{2013}\x{2014}()\[\]!?]/;
    my $original_data = join( '', grep { $_ !~ /^$allowed$/ }
      split( //u, $original ) );
    my $replacement_data = join( '', grep { $_ !~ /^$allowed$/ }
      split( //u, $replacement ) );
    return 0 unless $original_data eq $replacement_data;
    return 0 if $original =~ /[^\s.,:;\/=+\-\x{2013}\x{2014}()\[\]!?\p{L}\p{N}\p{M}\p{S}]/u
      && $replacement ne $original;
    return 1;
}

sub _normalize_punctuation {
    my ( $self, $text ) = @_;
    return $text unless defined $text;

# Strip space before prescribed punctuation marks (except opening parens/brackets)
# ISBD A.3.2.1: prescribed punctuation is preceded by a space, but commas and
# points are only followed by a space. Clean up double-space artifacts.
# Do NOT strip space before ( or [ — they need a preceding space per A.3.2.2.
    $text =~ s/\s+([,!?])/$1/g;

  # ISBD A.3.2.2: If closing parenthesis/bracket is followed by comma, point, or
  # any punctuation mark found on the resource, no space is used.
  # Handle: ),  . → ).  and ),  , → ),  etc.
    $text =~ s/([\]\)\}])\s+([,;:!?.\]])/$1$2/g;

# Preserve period-space-dash-space (". — ") area separator per ISBD A.3.2.3
# This is the critical convention: each area after the first is preceded by
# period-space-dash-space. We must NOT collapse or alter this pattern.
# CRITICAL: Preserve double-punctuation per ISBD A.3.2.7 FIRST — when element
# ends with a point (abbreviation) and prescribed punctuation begins with a point,
# both points are given. E.g. "3rd ed.. — " is correct, NOT "3rd ed. — ".
# Save ".. — " variants before normalization, restore after.
    my @double_punct;
    while ( $text =~ s/(\.{2})\s*[–—-]\s*/\x00DPSCR\x00/ ) {
        push @double_punct, '. — ';
    }

# Normalize various dash forms (em-dash, en-dash, hyphen) to ISBD standard ". — "
# Ensure exactly one space before the period and one space after the dash.
    $text =~ s/\s*\.\s*[–—-]\s*/. — /g;

    # Restore preserved double-punctuation area separators
    for my $dp (@double_punct) {
        $text =~ s/\x00DPSCR\x00/..$dp/;
    }

  # Also handle ". . — " (period-space-period before area separator) per A.3.2.7
    $text =~ s/\.\s+\.\s*[–—-]\s*/.. — /g;

   # Preserve common abbreviation/data points before an explicit area separator.
   # A final point in values such as "ed.", "ill.", "p.", or "Co." is not
   # wrong prescribed punctuation; it belongs to the element text.
    $text =~
s/\b(ed|ill|p|v|vol|no|etc|Co|Inc|Ltd|Dr|Mr|Mrs|Ms|Jr|Sr)\.\s*[–—-]\s*/$1.. — /gi;

# Comma-space: ensure space after comma (ISBD A.3.2.1: comma is only followed by space)
# But NOT before digits (to avoid breaking e.g. "p. 245-260" or dates)
# And NOT before closing parens/brackets (A.3.2.2: no space before closing)
    $text =~ s/,\s*([^\s\]\)\}\d])/, $1/g;

    # Semicolon-space: ensure space after semicolon
    # NOT before closing parens/brackets
    $text =~ s/;\s*([^\s\]\)\}])/; $1/g;

    # Colon: ensure proper spacing per ISBD
    # CRITICAL: Do NOT alter ratio colons (digit:digit) per ISBD 3.1.1.1
    # First pass: normalize existing space-colon-space patterns
    $text =~ s/\s*:\s*/ : /g;

# Second pass: restore ratio colons (digit:digit with no space) per ISBD 3.1.1.1
    $text =~ s/(\d)\s*:\s*(\d)/$1:$2/g;

  # Third pass: handle colons before closing brackets/parens (no trailing space)
    $text =~ s/\s*:\s*([\]\)\}])/:$1/g;

# Period-space: ensure space after period within elements
# BUT preserve double period (A.3.2.7) and period-space-dash (A.3.2.3)
# Don't add space after period if followed by another period, dash, or end of string
    $text =~ s/\.\s+(?![\s.–—-])([^\s\]\)\}])/\. $1/g;

    # Plus-space: ensure space around plus sign (ISBD prescribed punctuation)
    $text =~ s/\s*\+\s*/ + /g;

    # But not before closing parens/brackets (A.3.2.2)
    $text =~ s/\s+\+([\]\)\}])/ +$1/g;

    # Normalize multiple spaces to single space
    $text =~ s/  +/ /g;

    # Preserve leading spaces that are part of prescribed punctuation prefixes.
    $text =~ s/\s+$//;

    return $text;
}

# ISBD A.3.2.3: Each area after the first is preceded by ". — "
# MARC21 encoding uses subfield delimiters, so ". — " between areas is
# typically handled by the encoding itself. Within subfield values,
# we normalize em-dashes and en-dashes to the ISBD standard ". — ".
sub _normalize_area_separator {
    my ( $self, $text ) = @_;
    return $text unless defined $text;

    # Normalize various dash forms to ISBD standard ". — "
    $text =~ s/\s*\.\s*[–—]\s*/. — /g;
    return $text;
}

# ─── Suffix/prefix resolution ────────────────────────────────────────

sub _resolve_suffix {
    my ( $self, $check, $field, $code, $index ) = @_;
    my $mode            = $check->{suffix_mode}              || 'always';
    my $following       = $check->{when_following_subfields} || [];
    my $has_following   = 0;
    my $following_code  = '';
    my $prefix_override = '';
    if ( $following && ref $following eq 'ARRAY' ) {
        for my $wanted_code ( @{$following} ) {
            next
              unless _semantic_relation_exists( $self, $field, $index,
                $wanted_code, 'following' );
            my $sub = _select_semantic_relative( $self, $field, $index,
                [$wanted_code], 'following' );
            $has_following  = 1;
            $following_code = lc($wanted_code);
            if ($sub) {
                if ( $check->{suffix_if_following_prefixes}
                    && ref $check->{suffix_if_following_prefixes} eq 'ARRAY' )
                {
                    my $trimmed = $sub->{value} // '';
                    $trimmed =~ s/^\s+//;
                    $trimmed =~ s/\s+$//;
                    for
                      my $entry ( @{ $check->{suffix_if_following_prefixes} } )
                    {
                        next
                          unless $entry
                          && ref $entry eq 'HASH'
                          && defined $entry->{prefix};
                        my $prefix = $entry->{prefix};
                        $prefix =~ s/^\s+//;
                        $prefix =~ s/\s+$//;
                        next unless $prefix ne '';
                        if ( $trimmed =~ /^\Q$prefix\E/ ) {
                            $prefix_override = $entry->{suffix} // '';
                            last;
                        }
                    }
                }
            }
            last;
        }
    }
    if ( $mode eq 'conditional_following' ) {
        my $by_code = $check->{suffix_by_following_subfield};
        my $following_suffix =
          $prefix_override ne '' ? $prefix_override
          : (
            $following_code
              && $by_code
              && ref $by_code eq 'HASH' && exists $by_code->{$following_code}
            ? $by_code->{$following_code}
            : ( $check->{suffix_if_following} // '' )
          );
        return $has_following
          ? $following_suffix
          : ( $check->{suffix_if_last} // ( $check->{suffix} // '' ) );
    }
    if ( $mode eq 'when_following' ) {
        return $has_following
          ? ( $check->{suffix_if_following} // ( $check->{suffix} // '' ) )
          : '';
    }
    if ( $mode eq 'when_last' ) {
        return $has_following
          ? ''
          : ( $check->{suffix_if_last} // ( $check->{suffix} // '' ) );
    }
    return $check->{suffix} // '';
}

sub _resolve_prefix {
    my ( $self, $check, $field, $code, $index ) = @_;
    my $mode           = $check->{prefix_mode}              || 'always';
    my $preceding      = $check->{when_preceding_subfields} || [];
    my $has_preceding  = 0;
    my $preceding_code = '';
    if ( $preceding && ref $preceding eq 'ARRAY' && defined $index ) {
        for my $wanted_code ( @{$preceding} ) {
            next
              unless _semantic_relation_exists( $self, $field, $index,
                $wanted_code, 'preceding' );
            $has_preceding  = 1;
            $preceding_code = lc($wanted_code);
        }
    }
    if ( $mode eq 'conditional_preceding' ) {
        my $by_code = $check->{prefix_by_preceding_subfield};
        return $has_preceding
          ? (
            $preceding_code
              && $by_code
              && ref $by_code eq 'HASH' && exists $by_code->{$preceding_code}
            ? $by_code->{$preceding_code}
            : ( $check->{prefix_if_preceding} // ( $check->{prefix} // '' ) )
          )
          : ( $check->{prefix_if_first} // '' );
    }
    if ( $mode eq 'when_preceding' ) {
        return $has_preceding
          ? ( $check->{prefix_if_preceding} // ( $check->{prefix} // '' ) )
          : '';
    }
    if ( $mode eq 'when_first' ) {
        return $has_preceding
          ? ''
          : ( $check->{prefix_if_first} // ( $check->{prefix} // '' ) );
    }
    return $check->{prefix} // '';
}

sub _value_ends_with_any {
    my ( $self, $value, $suffixes ) = @_;
    return 0 unless defined $value && $suffixes && ref $suffixes eq 'ARRAY';
    for my $suffix ( @{$suffixes} ) {
        next unless defined $suffix && $suffix ne '';
        return 1 if $value =~ /\Q$suffix\E$/;
    }
    return 0;
}

sub _strip_endings {
    my ( $self, $value, $suffixes ) = @_;
    my $text = $value // '';
    return $text unless $suffixes && ref $suffixes eq 'ARRAY';
    for my $suffix ( @{$suffixes} ) {
        next unless defined $suffix && $suffix ne '';
        my $suffix_core = $suffix;
        $suffix_core =~ s/^\s+|\s+$//g;
        next if $suffix_core eq '.' && $text =~ /\.{2,}$/;
        $text =~ s/\Q$suffix\E$//;
    }
    return $text;
}

# ─── Expected value computation ──────────────────────────────────────

sub _strip_trailing_punct_preserve_double {
    my ( $self, $text, $suffix ) = @_;
    my $result = $text // '';
    $result =~ s/\s+$//;
    my $suffix_core = $suffix // '';
    $suffix_core =~ s/^\s+//;
    $suffix_core =~ s/\s+$//;
    return $result unless $suffix_core ne '';

    # Existing prescribed punctuation may be wrong for this boundary, but a
    # terminal period can also be meaningful data ("p.", "ill.", "Co.").
    # Only remove the exact punctuation mark the rule is about to prescribe.
    my $last = substr( $suffix_core, -1 );
    if ( $last =~ /[,;:+\/]/ ) {
        $result =~ s/\s*\Q$last\E\s*$//;
    }
    return $result;
}

sub _prefix_already_in_value {
    my ( $self, $value, $prefix ) = @_;
    return 0 unless defined $value && defined $prefix && $prefix ne '';
    my $prefix_trim = $prefix;
    $prefix_trim =~ s/^\s+//;
    $prefix_trim =~ s/\s+$//;
    return 0 unless $prefix_trim ne '';
    return 1 if $value =~ /^\s*\Q$prefix_trim\E\s*/;
    return 1 if $value =~ /^\s*\Q$prefix\E/;
    return 0;
}

sub _value_ends_with_prefix_core {
    my ( $self, $value, $prefix ) = @_;
    return 0 unless defined $value && defined $prefix && $prefix ne '';
    my $prefix_trim = $prefix;
    $prefix_trim =~ s/^\s+//;
    $prefix_trim =~ s/\s+$//;
    return 0 unless $prefix_trim ne '';
    my $text = $value // '';
    $text =~ s/\s+$//;
    return $text =~ /\Q$prefix_trim\E$/ ? 1 : 0;
}

sub _trim_terminal_period_for_following {
    my ( $self, $value, $subfield, $mode ) = @_;
    my $text = $value // '';
    $text =~ s/\s+$//;
    return $text unless $mode && $text =~ /\.$/;
    my $provenance = $subfield->{punctuation_provenance};
    if ( $provenance && ref $provenance eq 'HASH' ) {
        return $text
          if $provenance->{source}
          && $provenance->{source} ne 'plugin';
        if (   ( $provenance->{source} || '' ) eq 'plugin'
            && ( $provenance->{value} // '' ) eq ( $subfield->{value} // '' )
            && ( $provenance->{generated_suffix} // '' ) eq '.' )
        {
            $text =~ s/\.\s*$//;
            return $text;
        }
    }
    return $text unless $mode eq 'generated_or_plain_period';
    return $text if $text =~ /\.{2,}$/;
    my ($word) = $text =~ /([A-Za-z][A-Za-z'-]*)\.$/;
    return $text
      if defined $word
      && ( $word =~ /^[A-Za-z]$/
        || $word =~ /^(?:ed|ill|p|v|vol|no|etc|co|inc|ltd|dr|mr|mrs|ms|jr|sr)$/i );
    $text =~ s/\.\s*$//;
    return $text;
}

sub _expected_value_for_check {
    my ( $self, $check, $field, $subfield, $index ) = @_;
    my $value = $subfield->{value} // '';

    if ( $check->{replace_ellipses_with_dash} ) {
        $value =~ s/\.\s*\.\s*\./-/g;
        $value =~ s/\.{3,}/-/g;
    }
    if ( $check->{replace_square_brackets_with_parentheses} ) {
        $value =~ s/\[/(/g;
        $value =~ s/\]/)/g;
    }
    if ( $check->{strip_prefixes} && ref $check->{strip_prefixes} eq 'ARRAY' ) {
        for my $sp ( @{ $check->{strip_prefixes} } ) {
            next unless defined $sp && $sp ne '';
            my $re = qr/^\s*\Q$sp\E\s*/;
            $value =~ s/$re//;
        }
    }
    if ( $check->{end_not_in} && ref $check->{end_not_in} eq 'ARRAY' ) {
        $value = _strip_endings( $self, $value, $check->{end_not_in} );
    }
    if ( $check->{case_mode} ) {
        $value = _apply_case_mode( $self, $value, $check->{case_mode} );
    }

    my $prefix =
      _resolve_prefix( $self, $check, $field, $subfield->{code}, $index );
    my $suffix =
      _resolve_suffix( $self, $check, $field, $subfield->{code}, $index );
    my $has_following = 0;
    if ( $check->{when_following_subfields}
        && ref $check->{when_following_subfields} eq 'ARRAY' )
    {
        $has_following = scalar grep {
            _semantic_relation_exists( $self, $field, $index, $_,
                'following' )
        } @{ $check->{when_following_subfields} };
    }
    if (   !$suffix
        && $has_following
        && $check->{trim_terminal_when_following} )
    {
        $value = _trim_terminal_period_for_following( $self, $value, $subfield,
            $check->{trim_terminal_when_following} );
    }
    if ( $check->{parallel_prefix} && $value =~ /^\s*=/ ) {
        $value =~ s/^\s*=\s*//;
        $prefix = $check->{parallel_prefix};
    }

# PREFIX-SUFFIX INTERDEPENDENCE: Check if the related semantic element already
# provides our prefix. If its value ends with that mark, our prefix is redundant.
# E.g. if $a ends with " : " and our prefix is " : " for $b, skip our prefix.
    if ($prefix) {
        my $prev_sub = _select_semantic_relative( $self, $field, $index,
            $check->{when_preceding_subfields} || [], 'preceding' );
        my $prev_val =
          $prev_sub && defined $prev_sub->{value} ? $prev_sub->{value} : '';
        if ( _value_ends_with_prefix_core( $self, $prev_val, $prefix ) ) {

      # Previous subfield's suffix already provides our prefix — don't duplicate
      # But keep the prefix if it's a parallel prefix (= )
            unless ( $prefix =~ /=/ ) {
                $prefix = '';
            }
        }

    }
    if ( $prefix && _prefix_already_in_value( $self, $value, $prefix ) ) {
        $prefix = '';
    }

    if (   $check->{end_in}
        && ref $check->{end_in} eq 'ARRAY'
        && _value_ends_with_any( $self, $value, $check->{end_in} ) )
    {
        $suffix = '';
    }

# PREFIX-SUFFIX INTERDEPENDENCE: Check whether the related semantic element
# already starts with our suffix punctuation.
    if ( $suffix && $check->{skip_suffix_if_next_has_prefix} && defined $index )
    {
        my $next_sub = _select_semantic_relative( $self, $field, $index,
            $check->{when_following_subfields} || [], 'following' );
        my $next_val =
          $next_sub && defined $next_sub->{value} ? $next_sub->{value} : '';
        if ($next_val) {
            my $suffix_core = $suffix;
            $suffix_core =~ s/^\s+//;
            $suffix_core =~ s/\s+$//;
            if ( $suffix_core ne '' && $next_val =~ /^\s*\Q$suffix_core\E/ ) {

    # Next subfield already starts with our suffix punctuation — don't duplicate
                $suffix = '';
            }
        }
    }

    my $expected = $value;
    $expected =~ s/\s+$//g;

    my $generated_prefix = '';
    my $generated_suffix = '';

    # Apply prefix with interdependence awareness
    if ($prefix) {
        my $prefix_trim = $prefix;
        $prefix_trim =~ s/^\s+//;
        if ( $expected !~ /^\Q$prefix\E/
            && ( $prefix_trim eq '' || $expected !~ /^\Q$prefix_trim\E/ ) )
        {
            $expected = $prefix . $expected;
            $generated_prefix = $prefix;
        }
        elsif ($prefix_trim
            && $expected =~ /^\Q$prefix_trim\E/
            && $expected !~ /^\Q$prefix\E/ )
        {
            $expected =~ s/^\Q$prefix_trim\E/$prefix/;
        }
    }

    # Apply suffix with double-punctuation preservation (ISBD A.3.2.7)
    if ( $suffix && $expected !~ /\Q$suffix\E$/ ) {
        if ( !defined $check->{trim_trailing_punct}
            || $check->{trim_trailing_punct} )
        {
            $expected = _strip_trailing_punct_preserve_double( $self, $expected,
                $suffix );
        }
        $expected .= $suffix;
        $generated_suffix = $suffix;
        $generated_suffix =~ s/\s+$//;
    }

    if ( $check->{normalize_punctuation} ) {
        $expected = _normalize_punctuation( $self, $expected );
        if ( $suffix && $suffix =~ /\+\s$/ ) {
            my $suffix_trim = $suffix;
            $suffix_trim =~ s/\s+$//;
            $expected .= ' '
              if $suffix_trim ne ''
              && $expected =~ /\Q$suffix_trim\E$/
              && $expected !~ /\s$/;
        }
    }
    my $prior = $subfield->{punctuation_provenance};
    if ( $prior && ref $prior eq 'HASH'
        && ( $prior->{source} || '' ) eq 'plugin'
        && ( $prior->{value} // '' ) eq ( $subfield->{value} // '' ) )
    {
        $generated_prefix = $prior->{generated_prefix}
          if !$generated_prefix
          && $prior->{generated_prefix}
          && index( $expected, $prior->{generated_prefix} ) == 0;
        $generated_suffix = $prior->{generated_suffix}
          if !$generated_suffix
          && $prior->{generated_suffix}
          && $expected =~ /\Q$prior->{generated_suffix}\E$/;
    }
    my $provenance =
      ( $generated_prefix || $generated_suffix )
      ? {
        source           => 'plugin',
        value            => $expected,
        generated_prefix => $generated_prefix,
        generated_suffix => $generated_suffix,
      }
      : undef;
    return wantarray ? ( $expected, $provenance ) : $expected;
}

# ─── Case modes ──────────────────────────────────────────────────────

sub _apply_case_mode {
    my ( $self, $text, $mode ) = @_;
    return '' unless defined $text;
    return lc($text)                          if $mode eq 'lower';
    return _initial_lower( $self, $text )     if $mode eq 'initial_lower';
    return _initial_upper( $self, lc($text) ) if $mode eq 'sentence';
    return _initial_upper( $self, $text )     if $mode eq 'initial_upper';
    return _title_case( $self, $text )        if $mode eq 'title';
    return $text;
}

sub _initial_upper {
    my ( $self, $text ) = @_;
    my @chars = split( //, $text );
    for my $i ( 0 .. $#chars ) {
        if ( $chars[$i] =~ /[A-Za-z]/ ) {
            $chars[$i] = uc( $chars[$i] );
            last;
        }
    }
    return join( '', @chars );
}

sub _initial_lower {
    my ( $self, $text ) = @_;
    my @chars = split( //, $text );
    for my $i ( 0 .. $#chars ) {
        if ( $chars[$i] =~ /[A-Za-z]/ ) {
            $chars[$i] = lc( $chars[$i] );
            last;
        }
    }
    return join( '', @chars );
}

sub _title_case {
    my ( $self, $text ) = @_;
    my @words = split( /\s+/, $text );
    my @out;
    for my $word (@words) {
        if ( $word eq '' ) { push @out, $word; next; }
        my ( $leading, $core, $trailing ) =
          $word =~ /^([("\'\[]*)([A-Za-z][A-Za-z'.-]*)([^A-Za-z]*)$/;
        if ( !$core ) { push @out, $word; next; }
        if ( uc($core) eq $core && length($core) <= 3 ) {
            push @out, $leading . $core . ( $trailing || '' );
            next;
        }
        if ( $core =~ /^Mc[A-Za-z]/ ) {
            my $rest = substr( $core, 2 );
            push @out,
                $leading . 'Mc'
              . uc( substr( $rest, 0, 1 ) )
              . lc( substr( $rest, 1 ) )
              . ( $trailing || '' );
            next;
        }
        if ( index( $core, "'" ) >= 0 ) {
            my @parts = split( /'/, $core );
            @parts =
              map { $_ ? uc( substr( $_, 0, 1 ) ) . lc( substr( $_, 1 ) ) : $_ }
              @parts;
            push @out, $leading . join( "'", @parts ) . ( $trailing || '' );
            next;
        }
        push @out,
            $leading
          . uc( substr( $core, 0, 1 ) )
          . lc( substr( $core, 1 ) )
          . ( $trailing || '' );
    }
    return join( ' ', @out );
}

# ─── Shared check processing ────────────────────────────────────────
# This is the single source of truth for applying ISBD checks to a subfield.
# Both field-level and record-level validation use this.

sub _apply_check_to_subfield {
    my ( $self, $rule, $check, $field, $sub, $index ) = @_;
    my $value = $sub->{value} // '';
    return undef unless $value =~ /\S/;
    my $expected = $value;
    my $provenance;

    my $check_type = $check->{type} || '';

    if ( $check_type eq 'punctuation' ) {
        ( $expected, $provenance ) =
          _expected_value_for_check( $self, $check, $field, $sub, $index );
    }
    elsif ( $check_type eq 'separator' ) {
        my $sep = $check->{separator} // ' -- ';
        my $suffix =
          _resolve_suffix( $self, $check, $field, $sub->{code}, $index );
        $expected =~ s/[[:space:]]*[.,;:!?]+$//;
        if ( $suffix && $expected !~ /\Q$suffix\E$/ ) {
            $expected .= $suffix;
        }
        elsif ( $sep && $expected !~ /\Q$sep\E$/ ) {
            $expected .= $sep;
        }
        $expected = _normalize_punctuation( $self, $expected )
          if $check->{normalize_punctuation};
    }
    elsif ( $check_type eq 'no_terminal_punctuation' ) {
        $expected =~ s/[[:space:]]*[.,;:!?]+$//;
    }
    elsif ( $check_type eq 'spacing' ) {
        $expected =~ s/\s{2,}/ /g;
    }
    elsif ( $check_type eq 'normalize_punctuation' ) {
        if ( ( $rule->{id} || '' ) =~
            /^(ISBD_AREA_SEPARATOR_001|ISBD_DOUBLE_PUNCT_001)$/
            && $expected !~ /\.\s*[–—-]/ )
        {
            return undef;
        }
        $expected = _normalize_punctuation( $self, $expected );
    }
    elsif ( $check_type eq 'fixed_field' ) {
        return undef;
    }

    return undef if $expected eq $value;

    my $severity = $check->{severity} || $rule->{severity} || 'INFO';
    my $semantic =
      $field->{_relationship_model}
      && ref $field->{_relationship_model} eq 'HASH'
      && $field->{_relationship_model}{subfields}
      && ref $field->{_relationship_model}{subfields} eq 'HASH'
      ? ( $field->{_relationship_model}{subfields}{ $sub->{code} } || {} )
      : {};
    return {
        severity => $severity,
        code     => $rule->{id} || 'ISBD_RULE',
        message  => $check->{message}
          || "ISBD punctuation issue in $field->{tag}\$$sub->{code}",
        rationale      => $rule->{rationale} || '',
        tag            => $field->{tag},
        subfield       => $sub->{code},
        occurrence     => _normalize_occurrence( $self, $field->{occurrence} ),
        subfield_index => $index,
        current_value  => $value,
        expected_value => $expected,
        semantic_role  => $semantic->{role} || '',
        canonical_position => $semantic->{canonical_position},
        punctuation_provenance => $provenance,
        examples       => $rule->{examples} || [],
        proposed_fixes => [
            {
                label => ( $rule->{fixes} && $rule->{fixes}[0]{label} )
                  || 'Apply ISBD punctuation',
                patch => [
                    {
                        op         => 'replace_subfield',
                        tag        => $field->{tag},
                        code       => $sub->{code},
                        subfield   => $sub->{code},
                        occurrence =>
                          _normalize_occurrence( $self, $field->{occurrence} ),
                        subfield_index => $index,
                        value          => $expected,
                        punctuation_provenance => $provenance
                    }
                ]
            }
        ]
    };
}

# ─── Field-level validation ──────────────────────────────────────────

sub _validate_field_with_rules {
    my ( $self, $payload, $pack, $settings ) = @_;
    my @findings;
    my @rules = @{ $pack->{rules} || [] };
    my %matched_rules;
    my $tag        = $payload->{tag};
    my $occurrence = _normalize_occurrence( $self, $payload->{occurrence} );
    my $subfields  = $payload->{subfields} || [];
    my %semantic_payload = %{$payload};
    $semantic_payload{_relationship_model} =
      $pack->{field_relationships}
      && ref $pack->{field_relationships} eq 'HASH'
      ? ( $pack->{field_relationships}{$tag} || {} )
      : {};

    for my $i ( 0 .. $#{$subfields} ) {
        my $sub  = $subfields->[$i];
        my $code = $sub->{code};
        next if _is_excluded_field( $self, $settings, $tag, $code );
        my @matched = _filter_matched_rules( $self,
            grep {
                _rule_applies_to_subfield( $self, $_, \%semantic_payload,
                    $sub, $i )
            }
              @rules );
        $matched_rules{ $_->{id} } = 1 for @matched;
        for my $rule (@matched) {
            for my $check ( @{ $rule->{checks} || [] } ) {
                my $finding =
                  _apply_check_to_subfield( $self, $rule, $check,
                    \%semantic_payload, $sub, $i );
                push @findings, $finding if $finding;
            }
        }
    }
    return {
        tag      => $tag,
        findings => \@findings,
        coverage => {
            covered       => scalar keys %matched_rules ? 1 : 0,
            rule_ids      => [ sort keys %matched_rules ],
            rules_version => $pack->{version} || ''
        }
    };
}

# ─── Record-level validation ─────────────────────────────────────────

sub _validate_record_with_rules {
    my ( $self, $payload, $pack, $settings ) = @_;
    my @findings;
    my @rules = @{ $pack->{rules} || [] };

    for my $field ( @{ $payload->{fields} || [] } ) {
        my $tag        = $field->{tag};
        my $occurrence = _normalize_occurrence( $self, $field->{occurrence} );
        my $subfields  = $field->{subfields} || [];
        my %semantic_field = %{$field};
        $semantic_field{_relationship_model} =
          $pack->{field_relationships}
          && ref $pack->{field_relationships} eq 'HASH'
          ? ( $pack->{field_relationships}{$tag} || {} )
          : {};
        for my $i ( 0 .. $#{$subfields} ) {
            my $sub = $subfields->[$i];
            next if _is_excluded_field( $self, $settings, $tag, $sub->{code} );
            my @matched = _filter_matched_rules(
                $self,
                grep {
                    _rule_applies_to_subfield( $self, $_, \%semantic_field,
                        $sub, $i )
                } @rules
            );
            if (
                !@matched
                && (   $payload->{strict_coverage_mode}
                    || $settings->{strict_coverage_mode} )
              )
            {
                push @findings,
                  {
                    severity => 'INFO',
                    code     => 'ISBD_COVERAGE_MISSING',
                    message  =>
"No ISBD rule defined for $tag\$$sub->{code}; no punctuation assistance applied.",
                    rationale      => 'Strict coverage mode is enabled.',
                    tag            => $tag,
                    subfield       => $sub->{code},
                    occurrence     => $occurrence,
                    proposed_fixes => []
                  };
            }
            for my $rule (@matched) {
                for my $check ( @{ $rule->{checks} || [] } ) {
                    my $finding =
                      _apply_check_to_subfield( $self, $rule, $check,
                        \%semantic_field, $sub, $i );
                    push @findings, $finding if $finding;
                }
            }
        }
    }
    return {
        findings      => \@findings,
        rules_version => $pack->{version} || ''
    };
}

# ─── Occurrence normalization (shared with AI::Context) ──────────────

sub _normalize_occurrence {
    my ( $self, $value ) = @_;
    return 0 unless defined $value && $value ne '';
    return int($value) if looks_like_number($value);
    return 0;
}

1;
