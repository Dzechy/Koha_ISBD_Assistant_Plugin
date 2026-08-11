# This file is part of Koha.

package Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC;

use Modern::Perl;
use HTTP::Request;
use JSON qw(from_json);
use LWP::UserAgent;
use Time::HiRes qw(time);
use URI::Escape qw(uri_escape_utf8);
use Koha::Plugin::Cataloging::AutoPunctuation::AI::AuthorityCache ();

our $ADAPTER_VERSION = '1.0.0';
our $SOURCE_LABEL = 'Library of Congress Linked Data Service';
my $SUBJECT_BASE = 'https://id.loc.gov/authorities/subjects/';
my $SUGGEST_URL  = $SUBJECT_BASE . 'suggest2/';

sub _bounded_text {
    my ( $value, $limit ) = @_;
    return '' if !defined $value || ref $value;
    my $text = "$value";
    $text =~ s/^\s+|\s+$//g;
    return substr( $text, 0, $limit || 400 );
}

sub _string_list {
    my ( $value, $limit, $item_limit ) = @_;
    return [] unless ref $value eq 'ARRAY';
    my @items;
    for my $item ( @{$value} ) {
        last if @items >= ( $limit || 12 );
        my $text = _bounded_text( $item, $item_limit || 240 );
        push @items, $text if $text ne '';
    }
    return \@items;
}

sub _normalize_heading_key {
    my ($value) = @_;
    my $key = _bounded_text( $value, 480 );
    $key =~ s/[\x{2012}\x{2013}\x{2014}\x{2212}]+/--/g;
    $key =~ s/\s*--\s*/--/g;
    $key =~ s/\s+/ /g;
    return lc($key);
}

sub _https_subject_uri {
    my ($uri) = @_;
    my $value = _bounded_text( $uri, 300 );
    $value =~ s{^http://}{https://}i;
    return '' unless $value =~ m{\Ahttps://id\.loc\.gov/authorities/subjects/(sh\d+)\z}i;
    return $SUBJECT_BASE . lc($1);
}

sub _loc_ua {
    my ( $self, $settings ) = @_;
    return $self->{_loc_ua} if $self->{_loc_ua};
    my $timeout = int( $settings->{loc_authority_timeout_seconds} || 8 );
    $timeout = 2  if $timeout < 2;
    $timeout = 20 if $timeout > 20;
    my $ua = LWP::UserAgent->new(
        timeout => $timeout,
        agent   => 'Koha-ISBD-Assistant-LOC/' . $ADAPTER_VERSION,
    );
    $ua->max_redirect(0);
    $self->{_loc_ua} = $ua;
    return $self->{_loc_ua};
}

sub _failure_result {
    my ( $status, $error_type, $http_status ) = @_;
    return {
        scheme       => 'LCSH',
        status       => $status,
        match_type   => $status,
        checked      => $status eq 'no_match' ? 1 : 0,
        authorized   => 0,
        source       => $SOURCE_LABEL,
        adapter_version => $ADAPTER_VERSION,
        ( $error_type  ? ( error_type  => $error_type )  : () ),
        ( $http_status ? ( http_status => $http_status ) : () ),
        matches      => [],
    };
}

sub _http_failure_result {
    my ($response) = @_;
    my $code = $response ? ( $response->code || 0 ) : 0;
    return _failure_result( 'no_match', 'authority_no_match', 404 )
      if $code == 404;
    return _failure_result( 'service_unavailable', 'authority_rate_limited', 429 )
      if $code == 429;
    return _failure_result( 'service_unavailable', 'authority_timeout', $code )
      if $code == 408 || $code == 504;
    return _failure_result( 'service_unavailable', 'authority_unavailable', $code );
}

sub _normalized_hit {
    my ( $hit, $submitted ) = @_;
    return undef unless $hit && ref $hit eq 'HASH';
    my $uri = _https_subject_uri( $hit->{uri} );
    my $heading = _bounded_text( $hit->{aLabel} // $hit->{suggestLabel}, 240 );
    return undef unless $uri ne '' && $heading ne '';
    my $more = ref $hit->{more} eq 'HASH' ? $hit->{more} : {};
    my $variants = _string_list( $more->{variantLabels}, 20, 240 );
    my $submitted_key = _normalize_heading_key($submitted);
    my $heading_key   = _normalize_heading_key($heading);
    my $match_type = $submitted_key eq $heading_key ? 'exact_authorized' : '';
    if ( !$match_type ) {
        for my $variant ( @{$variants} ) {
            if ( _normalize_heading_key($variant) eq $submitted_key ) {
                $match_type = 'variant_match';
                last;
            }
        }
    }
    $match_type ||= 'close_candidate';
    my $lastmods = _string_list( $more->{lastmods}, 1, 40 );
    return {
        scheme             => 'LCSH',
        submitted_heading  => _bounded_text( $submitted, 240 ),
        heading            => $heading,
        authorized_heading => $heading,
        uri                => $uri,
        authorized         => 1,
        match_type         => $match_type,
        variants           => $variants,
        broader            => _string_list( $more->{broaders}, 12, 240 ),
        related            => _string_list( $more->{relateds}, 12, 240 ),
        source             => $SOURCE_LABEL,
        ( @{$lastmods} ? ( raw_source_version => $lastmods->[0] ) : () ),
    };
}

sub _rank_hits {
    my ($hits) = @_;
    my %rank = ( exact_authorized => 0, variant_match => 1, close_candidate => 2 );
    return [ sort {
        ( $rank{ $a->{match_type} } // 9 ) <=> ( $rank{ $b->{match_type} } // 9 )
          || lc( $a->{heading} || '' ) cmp lc( $b->{heading} || '' )
    } @{$hits} ];
}

sub _result_from_suggest_payload {
    my ( $payload, $query ) = @_;
    return _failure_result( 'invalid_authority_response', 'authority_invalid_response' )
      unless $payload && ref $payload eq 'HASH' && ref $payload->{hits} eq 'ARRAY';
    my @hits;
    my %seen;
    for my $raw ( @{ $payload->{hits} } ) {
        my $hit = _normalized_hit( $raw, $query );
        next unless $hit;
        next if $seen{ $hit->{uri} }++;
        push @hits, $hit;
        last if @hits >= 10;
    }
    return _failure_result( 'no_match', 'authority_no_match' ) unless @hits;
    my $ranked = _rank_hits(\@hits);
    my $best = $ranked->[0];
    my $match_type = $best->{match_type};
    my $status = $match_type eq 'close_candidate' ? 'unverified' : 'verified';
    my $is_complex = _normalize_heading_key($query) =~ /--/ ? 1 : 0;
    return {
        %{$best},
        status       => $status,
        checked      => 1,
        match_type   => $match_type,
        matches      => $ranked,
        checked_at   => scalar gmtime() . 'Z',
        adapter_version => $ADAPTER_VERSION,
        ( $is_complex
            ? ( construction_status => $match_type eq 'exact_authorized'
                ? 'full_heading_verified'
                : 'full_heading_not_verified' )
            : () ),
    };
}

sub search_lcsh {
    my ( $self, $query, $settings, $options ) = @_;
    $settings ||= {};
    $options  ||= {};
    my $submitted = _bounded_text( $query, 240 );
    return _failure_result( 'no_match', 'authority_no_match' ) if $submitted eq '';
    my $cache_query = _normalize_heading_key($submitted);
    unless ( $options->{force} ) {
        my $cached = Koha::Plugin::Cataloging::AutoPunctuation::AI::AuthorityCache::_authority_cache_get(
            $self, $settings, 'LCSH', $ADAPTER_VERSION, $cache_query );
        if ( $cached && ref $cached eq 'HASH' ) {
            return { %{$cached}, cache_status => 'hit' };
        }
    }
    my $count = int( $settings->{loc_authority_result_limit} || 8 );
    $count = 3  if $count < 3;
    $count = 10 if $count > 10;
    my $url = $SUGGEST_URL . '?q=' . uri_escape_utf8($submitted) . '&count=' . $count;
    my $request = HTTP::Request->new( 'GET', $url,
        [ 'Accept' => 'application/x-suggestions+json, application/json' ] );
    my $response = eval { _loc_ua( $self, $settings )->request($request) };
    return _failure_result( 'service_unavailable', 'authority_timeout' )
      if !$response && $@ =~ /timed?\s*out/i;
    return _failure_result( 'service_unavailable', 'authority_unavailable' )
      unless $response;
    return _http_failure_result($response) unless $response->is_success;
    my $decoded = eval { from_json( $response->decoded_content || '' ) };
    my $result = $decoded
      ? _result_from_suggest_payload( $decoded, $submitted )
      : _failure_result( 'invalid_authority_response', 'authority_invalid_response', $response->code );
    $result->{cache_status} = 'miss';
    Koha::Plugin::Cataloging::AutoPunctuation::AI::AuthorityCache::_authority_cache_set(
        $self, $settings, 'LCSH', $ADAPTER_VERSION, $cache_query, $result );
    return $result;
}

sub _jsonld_values {
    my ( $node, @properties ) = @_;
    return [] unless $node && ref $node eq 'HASH';
    my @values;
    for my $property (@properties) {
        next unless ref $node->{$property} eq 'ARRAY';
        for my $item ( @{ $node->{$property} } ) {
            my $value = ref $item eq 'HASH' ? $item->{'@value'} : $item;
            my $text = _bounded_text( $value, 600 );
            push @values, $text if $text ne '';
        }
    }
    return _string_list( \@values, 20, 600 );
}

sub _jsonld_ids {
    my ( $node, @properties ) = @_;
    return [] unless $node && ref $node eq 'HASH';
    my @ids;
    for my $property (@properties) {
        next unless ref $node->{$property} eq 'ARRAY';
        for my $item ( @{ $node->{$property} } ) {
            my $id = ref $item eq 'HASH' ? _bounded_text( $item->{'@id'}, 400 ) : '';
            push @ids, $id if $id ne '';
        }
    }
    return \@ids;
}

sub _jsonld_node_label {
    my ($node) = @_;
    my $labels = _jsonld_values(
        $node,
        'http://www.loc.gov/mads/rdf/v1#authoritativeLabel',
        'http://www.w3.org/2004/02/skos/core#prefLabel',
        'http://www.loc.gov/mads/rdf/v1#variantLabel',
        'http://www.w3.org/2004/02/skos/core#altLabel',
    );
    return $labels->[0] || '';
}

sub _jsonld_related_labels {
    my ( $node, $index, @properties ) = @_;
    my @labels;
    for my $id ( @{ _jsonld_ids( $node, @properties ) } ) {
        my $label = _jsonld_node_label( $index->{$id} );
        push @labels, $label if $label ne '';
    }
    return _string_list( \@labels, 20, 240 );
}

sub _normalized_jsonld_record {
    my ( $graph, $safe_uri, $response ) = @_;
    return _failure_result( 'invalid_authority_response', 'authority_invalid_response' )
      unless ref $graph eq 'ARRAY';
    my %index = map {
        ref $_ eq 'HASH' && defined $_->{'@id'} ? ( $_->{'@id'} => $_ ) : ()
    } @{$graph};
    ( my $http_uri = $safe_uri ) =~ s{^https://}{http://};
    my $node = $index{$safe_uri} || $index{$http_uri};
    return _failure_result( 'invalid_authority_response', 'authority_record_missing' )
      unless $node && ref $node eq 'HASH';
    my $heading = _jsonld_node_label($node);
    return _failure_result( 'invalid_authority_response', 'authority_label_missing' )
      if $heading eq '';

    my @variant_labels;
    for my $id ( @{ _jsonld_ids( $node, 'http://www.loc.gov/mads/rdf/v1#hasVariant' ) } ) {
        my $label = _jsonld_node_label( $index{$id} );
        push @variant_labels, $label if $label ne '';
    }
    push @variant_labels, @{ _jsonld_values( $node, 'http://www.w3.org/2004/02/skos/core#altLabel' ) };
    my $variants = _string_list( \@variant_labels, 20, 240 );
    my $broader = _jsonld_related_labels(
        $node, \%index,
        'http://www.loc.gov/mads/rdf/v1#hasBroaderAuthority',
        'http://www.w3.org/2004/02/skos/core#broader',
    );
    my $narrower = _jsonld_related_labels(
        $node, \%index,
        'http://www.loc.gov/mads/rdf/v1#hasNarrowerAuthority',
        'http://www.w3.org/2004/02/skos/core#narrower',
    );
    my $related = _jsonld_related_labels(
        $node, \%index,
        'http://www.loc.gov/mads/rdf/v1#hasReciprocalAuthority',
        'http://www.w3.org/2004/02/skos/core#related',
    );
    my $scope_notes = _jsonld_values(
        $node,
        'http://www.loc.gov/mads/rdf/v1#scopeNote',
        'http://www.w3.org/2004/02/skos/core#scopeNote',
    );
    my $source_version = $response
      ? _bounded_text( $response->header('Last-Modified') || $response->header('ETag'), 120 )
      : '';
    return {
        scheme             => 'LCSH',
        status             => 'verified',
        match_type         => 'exact_authorized',
        checked            => 1,
        authorized         => 1,
        heading            => $heading,
        authorized_heading => $heading,
        uri                => $safe_uri,
        source             => $SOURCE_LABEL,
        checked_at         => scalar gmtime() . 'Z',
        adapter_version    => $ADAPTER_VERSION,
        ( @{$variants}    ? ( variants    => $variants )    : () ),
        ( @{$broader}     ? ( broader     => $broader )     : () ),
        ( @{$narrower}    ? ( narrower    => $narrower )    : () ),
        ( @{$related}     ? ( related     => $related )     : () ),
        ( @{$scope_notes} ? ( scope_notes => $scope_notes ) : () ),
        ( $source_version ne '' ? ( raw_source_version => $source_version ) : () ),
    };
}

sub get_lcsh_record {
    my ( $self, $uri, $settings ) = @_;
    my $safe_uri = _https_subject_uri($uri);
    return _failure_result( 'invalid_authority_response', 'invalid_authority_uri' )
      unless $safe_uri;
    my $request = HTTP::Request->new( 'GET', $safe_uri . '.json',
        [ 'Accept' => 'application/json' ] );
    my $response = eval { _loc_ua( $self, $settings || {} )->request($request) };
    return _failure_result( 'service_unavailable', 'authority_unavailable' )
      unless $response;
    return _http_failure_result($response) unless $response->is_success;
    my $decoded = eval { from_json( $response->decoded_content || '' ) };
    return _failure_result( 'invalid_authority_response', 'authority_invalid_response', $response->code )
      unless ref $decoded eq 'ARRAY';
    return _normalized_jsonld_record( $decoded, $safe_uri, $response );
}

sub resolve_authority_uri { return get_lcsh_record(@_); }

sub _candidate_full_heading {
    my ($candidate) = @_;
    return '' unless $candidate && ref $candidate eq 'HASH';
    my @parts = ( $candidate->{heading} || '' );
    push @parts, map { $_->{value} || '' }
      grep { ref $_ eq 'HASH' } @{ $candidate->{subdivisions} || [] };
    return join( '--', grep { defined $_ && $_ =~ /\S/ } @parts );
}

sub verify_subject_candidates {
    my ( $self, $payload, $result, $settings, $options ) = @_;
    my $task = $payload->{task} || '';
    my $candidates = $task eq 'subject_heading_suggestion'
      ? $result->{candidates}
      : $task eq 'cataloging_review'
      ? $result->{subject_candidates}
      : [];
    return { status => 'not_applicable', results => [] }
      unless ref $candidates eq 'ARRAY' && @{$candidates};
    my $limit = int( $settings->{loc_authority_candidate_limit} || 5 );
    $limit = 1 if $limit < 1;
    $limit = 8 if $limit > 8;
    my @results;
    for my $candidate ( @{$candidates} ) {
        last if @results >= $limit;
        my $heading = _candidate_full_heading($candidate);
        next if $heading eq '';
        push @results, search_lcsh( $self, $heading, $settings, $options );
    }
    my $status = 'complete';
    $status = 'service_unavailable'
      if grep { ( $_->{status} || '' ) eq 'service_unavailable' } @results;
    $status = 'invalid_authority_response'
      if grep { ( $_->{status} || '' ) eq 'invalid_authority_response' } @results;
    return { status => $status, scheme => 'LCSH', results => \@results };
}

1;
