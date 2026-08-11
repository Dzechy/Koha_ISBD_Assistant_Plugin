use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;
use JSON qw(from_json);

BEGIN {
    package C4::Context;
    $INC{'C4/Context.pm'} = 1;
}

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract;
use Koha::Plugin::Cataloging::AutoPunctuation::Api;

my $fixture_path = File::Spec->catfile(
    $Bin, 'fixtures', 'ai_cataloging_response_regression.json' );
open my $fh, '<:encoding(UTF-8)', $fixture_path or die $!;
my $fixture = from_json( do { local $/; <$fh> } );
close $fh;

my $harness = bless {}, 'Local::CatalogingPipelineHarness';
my $payload = {
    request_id => 'cataloging-regression', task => 'cataloging_review',
    features => { call_number_guidance => 1, subject_guidance => 1 },
    tag_context => { tag => '245', subfields => [] },
};
my $recovered =
  Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_recover_cataloging_task_response(
    $harness, $payload, $fixture->{raw_non_structured}, {} );
ok( $recovered, 'safe degraded recovery accepts recognizable cataloguing candidates' );
is( $recovered->{ai_parse_status}, 'degraded_recovery', 'recovery is explicitly identified' );
is( $recovered->{classification_candidate}{value}, 'QA76.73', 'classification survives malformed structured output' );
is( scalar @{ $recovered->{subject_candidates} }, 2, 'explicit subject list survives malformed structured output' );
ok( $recovered->{requires_human_review}, 'recovered output remains review-required' );

my $projected = Koha::Plugin::Cataloging::AutoPunctuation::Api::_task_response_for_client(
    $payload, $recovered, [] );
is( $projected->{classification}, 'QA76.73', 'client projection retains recovered classification' );
is( scalar @{ $projected->{subjects} }, 2, 'client projection retains recovered subjects' );
unlike( $projected->{assistant_message}, qr/^\s*\(none\)\s*$/i,
    'regression does not project a meaningless none rationale' );
like( $projected->{rationale}{system}, qr/recovered from non-structured/i,
    'system note truthfully identifies degraded recovery' );

my $subject_payload = {
    request_id => 'subject-regression', task => 'subject_heading_suggestion',
    tag_context => {},
};
my $structured = $fixture->{structured_subjects};
Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_normalize_ai_task_response(
    $harness, $subject_payload, $structured,
    { lcsh_evidence => {
        status => 'complete', results => [{
            scheme => 'LCSH', status => 'verified', checked => 1,
            authorized => 1, match_type => 'exact_authorized',
            heading => 'Artificial intelligence',
            authorized_heading => 'Artificial intelligence',
            uri => 'https://id.loc.gov/authorities/subjects/sh85008180',
            source => 'Library of Congress Linked Data Service',
        }]
    } }
);
my $subject_projection =
  Koha::Plugin::Cataloging::AutoPunctuation::Api::_task_response_for_client(
    $subject_payload, $structured, [] );
is( $subject_projection->{subjects}[0]{authority}{match_type},
    'exact_authorized', 'authority evidence reaches the stable client projection' );
like( $subject_projection->{subjects}[0]{rationale}{ai}, qr/central topic/,
    'subject AI rationale reaches the client projection' );
is( $subject_projection->{client_response_version}, '2.0.0',
    'client response projection is independently versioned' );

my $malformed = {
    schema_version => '1.0.0', task => 'cataloging_review',
    status => 'insufficient_evidence', findings => [], warnings => [],
    subject_candidates => [], requires_human_review => JSON::true,
    ai_parse_status => 'malformed',
};
my $malformed_projection =
  Koha::Plugin::Cataloging::AutoPunctuation::Api::_task_response_for_client(
    $payload, $malformed, [] );
like( $malformed_projection->{rationale}{system}, qr/could not be safely parsed/i,
    'malformed is distinct from an empty evidence response' );

done_testing();
