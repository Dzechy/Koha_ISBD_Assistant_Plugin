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

package Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard;

use Modern::Perl;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Context ();

sub _validate_ai_response_guardrails {
    my ( $self, $payload, $result, $pack, $settings ) = @_;
    return 'AI response missing request_id.' unless $result->{request_id};
    return 'AI response request_id mismatch.'
      if $payload->{request_id} ne $result->{request_id};
    my $tag_context = $payload->{tag_context} || {};
    my $target_tag  = $tag_context->{tag}     || '';
    my $target_occurrence =
      defined $tag_context->{occurrence}
      ? $self->_normalize_occurrence( $tag_context->{occurrence} )
      : 0;
    my %subfield_values;
    my $context_subfields = $tag_context->{subfields} || [];

    for my $i ( 0 .. $#{$context_subfields} ) {
        my $sub = $context_subfields->[$i];
        next unless $sub->{code};
        $subfield_values{
            join( '|', $target_tag, $target_occurrence, $sub->{code}, $i ) } =
          $sub->{value} // '';
    }

    my $field_payload = {
        tag       => $target_tag,
        ind1      => $tag_context->{ind1} || '',
        ind2      => $tag_context->{ind2} || '',
        subfields => [
            map {
                my $sub = { code => $_->{code}, value => $_->{value} };
                $sub->{punctuation_provenance} =
                  { %{ $_->{punctuation_provenance} } }
                  if $_->{punctuation_provenance}
                  && ref $_->{punctuation_provenance} eq 'HASH';
                $sub;
            }
              @{ $tag_context->{subfields} || [] }
        ]
    };
    my $deterministic =
      $self->_validate_field_with_rules( $field_payload, $pack, $settings );
    my %expected_by_target;
    for my $finding ( @{ $deterministic->{findings} || [] } ) {
        my $patch =
             $finding->{proposed_fixes}
          && $finding->{proposed_fixes}[0]
          && $finding->{proposed_fixes}[0]{patch}[0];
        next unless $patch;
        my $code =
          $patch->{code} || $patch->{subfield} || $finding->{subfield} || '';
        my $idx =
          defined $patch->{subfield_index}
          ? $patch->{subfield_index}
          : $finding->{subfield_index};
        my $value =
          defined $patch->{value}
          ? $patch->{value}
          : ( $patch->{replacement_text} // '' );
        next
          unless $code ne '' && defined $idx && defined $value && $value ne '';
        $expected_by_target{
            join( '|', $target_tag, $target_occurrence, $code, $idx ) } =
          $value;
    }

    for my $finding ( @{ $result->{findings} || [] } ) {
        my $fixes = $finding->{proposed_fixes} || [];
        next unless ref $fixes eq 'ARRAY';
        return 'AI responses may not contain raw MARC mutations.' if @{$fixes};
        for my $fix ( @{$fixes} ) {
            my $patches = $fix->{patch} || [];
            for my $patch ( @{$patches} ) {
                return 'Unsupported AI patch operation.'
                  unless ( $patch->{op} || '' ) eq 'replace_subfield';
                return 'AI patch missing tag or subfield.'
                  unless $patch->{tag} && $patch->{subfield};
                return 'AI patch scope violation.'
                  unless $patch->{tag} eq $target_tag;
                my $occurrence =
                  defined $patch->{occurrence}
                  ? $self->_normalize_occurrence( $patch->{occurrence} )
                  : 0;
                return 'AI patch occurrence mismatch.'
                  unless $occurrence == $target_occurrence;
                return 'AI patch missing subfield index.'
                  unless defined $patch->{subfield_index};
                my $target_key = join( '|',
                    $patch->{tag}, $occurrence, $patch->{subfield},
                    $patch->{subfield_index} );
                return 'AI patch references unknown subfield.'
                  unless exists $subfield_values{$target_key};
                my $original    = $patch->{original_text}    // '';
                my $replacement = $patch->{replacement_text} // '';
                return 'AI patch original text mismatch.'
                  unless $original eq $subfield_values{$target_key};
                return 'AI patch contains non-punctuation edits.'
                  unless $self->_punctuation_only_change( $original,
                    $replacement );

                if ( exists $expected_by_target{$target_key} ) {
                    my $expected = $expected_by_target{$target_key} // '';
                    return 'AI patch conflicts with deterministic rules.'
                      unless $expected && $replacement eq $expected;
                }
            }
        }
    }
    return '';
}

sub _redact_tag_context {
    my ( $self, $tag_context, $settings ) = @_;

# Guardrails aligned with ISBD 2021 Update A.3.2:
# - Prescribed punctuation retained even when double punctuation results (A.3.2.7)
# - Parentheses/brackets treated as single symbols (A.3.2.2)
# - Area separator ". — " preserved (A.3.2.3)
# - Ratio colons in scale statements not altered (ISBD 3.1.1.1)
# - Heading fields (1XX/6XX/7XX/8XX) no forced terminal punctuation
    return {} unless $tag_context && ref $tag_context eq 'HASH';
    my %clone = %{$tag_context};
    if ( $clone{subfields} && ref $clone{subfields} eq 'ARRAY' ) {
        my @redacted;
        for my $sub ( @{ $clone{subfields} } ) {
            my $value =
              _redact_value( $self, $settings, $clone{tag}, $sub->{code},
                $sub->{value} );
            my $redacted = { code => $sub->{code}, value => $value };
            $redacted->{punctuation_provenance} =
              { %{ $sub->{punctuation_provenance} } }
              if $sub->{punctuation_provenance}
              && ref $sub->{punctuation_provenance} eq 'HASH'
              && $value eq ( $sub->{value} // '' )
              && ( $sub->{punctuation_provenance}{value} // '' ) eq
              ( $sub->{value} // '' );
            push @redacted, $redacted;
        }
        $clone{subfields} = \@redacted;
    }
    return \%clone;
}

sub _redact_record_context {
    my ( $self, $record_context, $settings ) = @_;
    return {} unless $record_context && ref $record_context eq 'HASH';
    my %clone = %{$record_context};
    if ( $clone{fields} && ref $clone{fields} eq 'ARRAY' ) {
        my @fields;
        for my $field ( @{ $clone{fields} } ) {
            my %f = %{$field};
            if ( $f{subfields} && ref $f{subfields} eq 'ARRAY' ) {
                my @subs;
                for my $sub ( @{ $f{subfields} } ) {
                    my $value =
                      _redact_value( $self, $settings, $f{tag}, $sub->{code},
                        $sub->{value} );
                    push @subs, { code => $sub->{code}, value => $value };
                }
                $f{subfields} = \@subs;
            }
            push @fields, \%f;
        }
        $clone{fields} = \@fields;
    }
    return \%clone;
}

sub _filter_record_context {
    my ( $self, $record_context, $settings, $tag_context, $task ) = @_;
    return {} unless $record_context && ref $record_context eq 'HASH';
    $task ||= $settings->{_ai_task} || '';
    my $cataloging_task = $task =~
      /^(?:cataloging_classification|subject_heading_suggestion|cataloging_review)$/
      ? 1
      : 0;
    my $mode = $settings->{ai_context_mode} || 'tag_only';
    $mode = 'tag_plus_related_fields' if $mode eq 'tag_plus_neighbors';
    $mode = 'full_record' if $mode eq 'full';
    $mode = 'tag_plus_related_fields' if $cataloging_task;
    return {} if $mode eq 'tag_only';
    my $fields = $record_context->{fields};
    return {} unless $fields && ref $fields eq 'ARRAY' && @{$fields};
    my $normalized =
      $self->_normalize_record_context( $record_context, 30, 30, $task );
    my @list = @{ $normalized->{fields} || [] };
    @list = map {
        my $field = $_;
        my @subfields = grep {
            my $sub = $_;
            my $excluded = $self->can('_is_excluded_field')
              ? $self->_is_excluded_field(
                $settings, $field->{tag} || '', $sub->{code} || '' )
              : 0;
            !$excluded;
        } @{ $field->{subfields} || [] };
        @subfields ? { %{$field}, subfields => \@subfields } : ();
    } @list;
    return {} unless @list;

    if ($cataloging_task) {
        my $position = 0;
        my @prioritized = map { $_->{field} } sort {
            Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_cataloging_evidence_rank(
                $self, $a->{field}{tag} )
              <=> Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_cataloging_evidence_rank(
                $self, $b->{field}{tag} )
              || $a->{position} <=> $b->{position}
        } map { { field => $_, position => $position++ } } @list;
        @prioritized = @prioritized[ 0 .. 23 ] if @prioritized > 24;
        return { fields => \@prioritized };
    }

    if ( $mode eq 'tag_plus_related_fields' ) {
        my $target_tag = $tag_context
          && ref $tag_context eq 'HASH' ? ( $tag_context->{tag} || '' ) : '';
        my $target_occ =
            $tag_context && ref $tag_context eq 'HASH'
          ? $self->_normalize_occurrence( $tag_context->{occurrence} )
          : 0;
        my %related = map { $_ => 1 }
          qw(020 022 024 041 100 110 111 130 240 245 246 250 254 255 260 264 300 306 336 337 338 362 440 490 500 501 502 504 505 506 507 508 511 518 520 521 522 524 525 530 533 534 538 546 550 555 600 610 611 630 648 650 651 655 700 710 711 730 740 752 765 767 770 772 773 775 776 780 785 787 800 810 811 830);
        my @subset = grep {
            my $field = $_ || {};
            my $tag   = $field->{tag} || '';
            ( $tag eq $target_tag
                  && $self->_normalize_occurrence( $field->{occurrence} ) == $target_occ )
              || $related{$tag}
        } @list;
        @subset = @subset[ 0 .. 14 ] if @subset > 15;
        return { fields => \@subset };
    }
    my $max = 30;
    if ( @list > $max ) {
        return { fields => [ @list[ 0 .. $max - 1 ] ] };
    }
    return { fields => \@list };
}

sub _redact_value {
    my ( $self, $settings, $tag, $subfield, $value ) = @_;
    if (   $settings->{ai_redact_856_querystrings}
        && $tag eq '856'
        && lc( $subfield || '' ) eq 'u' )
    {
        return '[REDACTED]' if defined $value && $value =~ /[?&]/;
    }
    my @rules = split( /\s*,\s*/, $settings->{ai_redaction_rules} || '' );
    my $should_redact = scalar grep {
        my $entry = $_;
             $entry =~ /^9XX$/i            ? _is_local_tag($tag)
          :  $entry =~ /^(\d)XX$/i         ? $tag =~ /^$1\d\d$/
          :  $entry =~ /^\d{3}[a-z0-9]$/i ? lc($entry) eq lc( $tag . $subfield )
          :  $entry =~ /^\d{3}$/           ? $entry eq $tag
          :                                  0;
    } @rules;
    return $should_redact ? '[REDACTED]' : $value;
}

sub _is_local_tag {
    my ($tag) = @_;
    return 0 unless defined $tag;
    return $tag =~ /^9\d\d$/ ? 1 : 0;
}

1;
