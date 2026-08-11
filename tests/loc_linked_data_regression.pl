use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;
use HTTP::Response;
use JSON qw(to_json);

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC;

{
    package Local::QueueUA;
    sub new { bless { responses => $_[1] || [], calls => 0 }, $_[0] }
    sub request {
        my ( $self, $request ) = @_;
        $self->{calls}++;
        $self->{last_request} = $request;
        return shift @{ $self->{responses} };
    }
}

sub response {
    my ( $code, $body ) = @_;
    return HTTP::Response->new( $code, '',
        [ 'Content-Type' => 'application/x-suggestions+json' ], $body || '' );
}

my $payload = {
    hits => [{
        suggestLabel => 'Artificial intelligence',
        uri => 'http://id.loc.gov/authorities/subjects/sh85008180',
        aLabel => 'Artificial intelligence',
        more => {
            variantLabels => ['Machine intelligence'],
            broaders => ['Cognitive science'],
            relateds => ['Expert systems'],
            lastmods => ['2024-10-01'],
        }
    }]
};

my $exact_ua = Local::QueueUA->new([ response( 200, to_json($payload) ) ]);
my $exact = bless { _loc_ua => $exact_ua }, 'Local::LOCHarness';
my $result = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $exact, 'Artificial intelligence', {}, { force => 1 } );
is( $result->{match_type}, 'exact_authorized', 'exact authorized label is verified' );
is( $result->{status}, 'verified', 'exact match has verified status' );
like( $result->{uri}, qr/^https:/, 'LOC URI is upgraded and constrained to HTTPS' );

my $variant_ua = Local::QueueUA->new([ response( 200, to_json($payload) ) ]);
my $variant = bless { _loc_ua => $variant_ua }, 'Local::LOCHarness';
$result = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $variant, 'Machine intelligence', {}, { force => 1 } );
is( $result->{match_type}, 'variant_match', 'variant label is distinguished from authorized label' );
is( $result->{authorized_heading}, 'Artificial intelligence', 'variant resolves to authorized heading' );

my $close_ua = Local::QueueUA->new([ response( 200, to_json($payload) ) ]);
my $close = bless { _loc_ua => $close_ua }, 'Local::LOCHarness';
$result = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $close, 'Intelligent computing', {}, { force => 1 } );
is( $result->{match_type}, 'close_candidate', 'close candidate is not promoted to verified' );
is( $result->{status}, 'unverified', 'close candidate remains unverified' );

for my $case (
    [ 404, 'no_match', 'authority_no_match' ],
    [ 429, 'service_unavailable', 'authority_rate_limited' ],
    [ 504, 'service_unavailable', 'authority_timeout' ],
    [ 500, 'service_unavailable', 'authority_unavailable' ],
) {
    my $ua = Local::QueueUA->new([ response( $case->[0], '{}' ) ]);
    my $harness = bless { _loc_ua => $ua }, 'Local::LOCHarness';
    my $failure = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
        $harness, "Failure $case->[0]", {}, { force => 1 } );
    is( $failure->{status}, $case->[1], "HTTP $case->[0] has explicit authority status" );
    is( $failure->{error_type}, $case->[2], "HTTP $case->[0] has explicit error category" );
}

my $malformed_ua = Local::QueueUA->new([ response( 200, '{not json' ) ]);
my $malformed = bless { _loc_ua => $malformed_ua }, 'Local::LOCHarness';
$result = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $malformed, 'Malformed', {}, { force => 1 } );
is( $result->{status}, 'invalid_authority_response', 'malformed LOC JSON is not treated as no-match' );

my $cache_ua = Local::QueueUA->new([ response( 200, to_json($payload) ) ]);
my $cache = bless { _loc_ua => $cache_ua, _authority_cache_backend => undef }, 'Local::LOCHarness';
my $first = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $cache, 'Cacheable artificial intelligence', {}, {} );
my $second = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $cache, 'Cacheable artificial intelligence', {}, {} );
is( $cache_ua->{calls}, 1, 'dedicated authority cache prevents repeated external lookup' );
is( $second->{cache_status}, 'hit', 'authority cache hit is explicit' );

my $complex_payload = {
    hits => [{
        suggestLabel => 'Libraries--History',
        uri => 'http://id.loc.gov/authorities/subjects/sh12345678',
        aLabel => 'Libraries--History', more => {}
    }]
};
my $complex_ua = Local::QueueUA->new([ response( 200, to_json($complex_payload) ) ]);
my $complex = bless { _loc_ua => $complex_ua }, 'Local::LOCHarness';
$result = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $complex, 'Libraries -- History', {}, { force => 1 } );
is( $result->{construction_status}, 'full_heading_verified',
    'complete constructed heading is only verified on a complete exact record' );

my $record_graph = [
    {
        '@id' => 'http://id.loc.gov/authorities/subjects/sh85008180',
        'http://www.loc.gov/mads/rdf/v1#authoritativeLabel' => [ { '@value' => 'Artificial intelligence' } ],
        'http://www.loc.gov/mads/rdf/v1#hasVariant' => [ { '@id' => '_:variant' } ],
        'http://www.loc.gov/mads/rdf/v1#hasBroaderAuthority' => [
            { '@id' => 'http://id.loc.gov/authorities/subjects/sh85014250' }
        ],
        'http://www.loc.gov/mads/rdf/v1#scopeNote' => [ { '@value' => 'Here are entered works on intelligence demonstrated by machines.' } ],
    },
    {
        '@id' => '_:variant',
        'http://www.loc.gov/mads/rdf/v1#variantLabel' => [ { '@value' => 'Machine intelligence' } ],
    },
    {
        '@id' => 'http://id.loc.gov/authorities/subjects/sh85014250',
        'http://www.loc.gov/mads/rdf/v1#authoritativeLabel' => [ { '@value' => 'Bionics' } ],
    },
];
my $record_response = response( 200, to_json($record_graph) );
$record_response->header( 'Last-Modified' => 'Tue, 11 Aug 2026 00:00:00 GMT' );
my $record_ua = Local::QueueUA->new([$record_response]);
my $record_harness = bless { _loc_ua => $record_ua }, 'Local::LOCHarness';
my $record = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::get_lcsh_record(
    $record_harness, 'https://id.loc.gov/authorities/subjects/sh85008180', {} );
is( $record->{heading}, 'Artificial intelligence', 'dereferenced JSON-LD record is normalized' );
is_deeply( $record->{variants}, ['Machine intelligence'], 'JSON-LD variants are normalized' );
is_deeply( $record->{broader}, ['Bionics'], 'JSON-LD relation identifiers resolve to labels' );
ok( !exists $record->{graph}, 'raw JSON-LD graph is not exposed outside the adapter' );
like( $record_ua->{last_request}->uri->as_string, qr/\.json\z/, 'record lookup uses a fixed machine-readable endpoint' );

my $invalid = Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::get_lcsh_record(
    $record_harness, 'https://example.test/authorities/subjects/sh85008180', {} );
is( $invalid->{error_type}, 'invalid_authority_uri', 'arbitrary authority URIs are rejected before I/O' );

done_testing();
