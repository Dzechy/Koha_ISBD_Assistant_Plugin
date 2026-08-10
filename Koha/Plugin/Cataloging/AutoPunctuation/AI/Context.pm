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

package Koha::Plugin::Cataloging::AutoPunctuation::AI::Context;

use Modern::Perl;
use Scalar::Util qw(looks_like_number);

sub _normalize_occurrence {
    my ( $self, $value ) = @_;
    return 0 unless defined $value && $value ne '';
    return int($value) if looks_like_number($value);
    return 0;
}

sub _normalize_tag_context {
    my ( $self, $tag_context, $max_subfields ) = @_;
    return {} unless $tag_context && ref $tag_context eq 'HASH';
    my $occurrence = _normalize_occurrence( $self, $tag_context->{occurrence} );
    my $active_subfield = $tag_context->{active_subfield};
    $active_subfield = '' unless defined $active_subfield;
    $active_subfield = lc($active_subfield);
    $active_subfield = substr( $active_subfield, 0, 1 )
      if length($active_subfield) > 1;
    my @subfields =
      grep { ref $_ eq 'HASH' } @{ $tag_context->{subfields} || [] };

    if ( defined $max_subfields && @subfields > $max_subfields ) {
        my $primary_index = 0;
        if ($active_subfield) {
            for my $i ( 0 .. $#subfields ) {
                if ( lc( $subfields[$i]{code} || '' ) eq $active_subfield ) {
                    $primary_index = $i;
                    last;
                }
            }
        }
        my $primary = splice @subfields, $primary_index, 1;
        my $remaining = $max_subfields - 1;
        my @rest = $remaining > 0 ? @subfields[ 0 .. ( $remaining - 1 ) ] : ();
        @subfields = ( $primary, @rest );
    }
    my @normalized = map {
        my $sub = {
            code  => $_->{code} // '',
            value => defined $_->{value} ? $_->{value} : ''
        };
        $sub->{punctuation_provenance} = { %{ $_->{punctuation_provenance} } }
          if $_->{punctuation_provenance}
          && ref $_->{punctuation_provenance} eq 'HASH'
          && ( $_->{punctuation_provenance}{value} // '' ) eq $sub->{value};
        $sub;
    } @subfields;
    my %clone = %{$tag_context};
    $clone{occurrence}      = $occurrence;
    $clone{subfields}       = \@normalized;
    $clone{active_subfield} = $active_subfield if $active_subfield;
    return \%clone;
}

sub _normalize_record_context {
    my ( $self, $record_context, $max_fields, $max_subfields ) = @_;
    return undef unless $record_context && ref $record_context eq 'HASH';
    my @fields = grep { ref $_ eq 'HASH' } @{ $record_context->{fields} || [] };
    if ( defined $max_fields && @fields > $max_fields ) {
        @fields = @fields[ 0 .. ( $max_fields - 1 ) ];
    }
    my @normalized;
    for my $field (@fields) {
        my @subfields =
          grep { ref $_ eq 'HASH' } @{ $field->{subfields} || [] };
        if ( defined $max_subfields && @subfields > $max_subfields ) {
            @subfields = @subfields[ 0 .. ( $max_subfields - 1 ) ];
        }
        my @subs = map {
            {
                code  => $_->{code} // '',
                value => defined $_->{value} ? $_->{value} : ''
            }
        } @subfields;
        my %clone = %{$field};
        $clone{occurrence} =
          _normalize_occurrence( $self, $field->{occurrence} );
        $clone{subfields} = \@subs;
        push @normalized, \%clone;
    }
    return { fields => \@normalized };
}

sub _normalize_ai_features {
    my ( $self, $features ) = @_;
    my %normalized = (
        punctuation_explain => ( $features && $features->{punctuation_explain} )
        ? 1
        : 0,
        subject_guidance => ( $features && $features->{subject_guidance} ) ? 1
        : 0,
        call_number_guidance =>
          ( $features && $features->{call_number_guidance} ) ? 1 : 0
    );
    return \%normalized;
}

sub _normalize_ai_request_payload {
    my ( $self, $payload, $settings ) = @_;
    return $payload unless $payload && ref $payload eq 'HASH';
    my %clone = %{$payload};
    $clone{task} = lc( $payload->{task} || '' );
    my $context_mode = lc( $payload->{context_mode} || $settings->{ai_context_mode} || 'tag_only' );
    $context_mode = 'tag_plus_related_fields' if $context_mode eq 'tag_plus_neighbors';
    $context_mode = 'full_record'             if $context_mode eq 'full';
    $clone{context_mode} = $context_mode;
    $clone{tag_context} =
      _normalize_tag_context( $self, $payload->{tag_context}, 20 );
    if ( $payload->{record_context} ) {
        $clone{record_context} =
          _normalize_record_context( $self, $payload->{record_context}, 30,
            30 );
    }
    $clone{features} = _normalize_ai_features( $self, $payload->{features} );
    return \%clone;
}

sub _normalize_record_context_for_cache {
    my ( $self, $record_context ) = @_;
    return {} unless $record_context && ref $record_context eq 'HASH';
    my @fields = grep { ref $_ eq 'HASH' } @{ $record_context->{fields} || [] };
    @fields = sort {
        ( $a->{tag} || '' ) cmp( $b->{tag} || '' )
          || _normalize_occurrence( $self, $a->{occurrence} )
          <=> _normalize_occurrence( $self, $b->{occurrence} )
    } @fields;
    my @normalized;
    for my $field (@fields) {
        # Subfield occurrence order is semantic MARC data. Never sort it for a
        # cache key: $a First/$a Second is not $a Second/$a First.
        my @subfields =
          grep { ref $_ eq 'HASH' } @{ $field->{subfields} || [] };
        push @normalized, {
            tag        => $field->{tag}  || '',
            ind1       => $field->{ind1} || '',
            ind2       => $field->{ind2} || '',
            occurrence => _normalize_occurrence( $self, $field->{occurrence} ),
            subfields  => [
                map {
                    {
                        code  => $_->{code} || '',
                        value => defined $_->{value} ? $_->{value} : ''
                    }
                } @subfields
            ]
        };
    }
    return { fields => \@normalized };
}

1;
