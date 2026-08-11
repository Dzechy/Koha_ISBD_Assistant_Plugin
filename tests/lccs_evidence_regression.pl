use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS;

{
    package Local::LCCSHarness;
    sub new { bless {}, shift }
    sub get_plugin_dir {
        return File::Spec->rel2abs(
            File::Spec->catdir(qw(Koha Plugin Cataloging AutoPunctuation)) );
    }
}

my $harness = Local::LCCSHarness->new;
my $payload = { task => 'cataloging_classification' };
my $verified = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    $harness, $payload, { candidate => { value => 'Z665' } } );
is( $verified->{status}, 'verified', 'classification candidate is verified' );
is( $verified->{source}, 'lccs-2024@1.1.0', 'published package version is reported' );
is( $verified->{matches}[0]{caption}, 'General works', 'schedule caption is returned as evidence' );

my $unmatched = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    $harness, $payload, { candidate => { value => 'ZZ999999' } } );
is( $unmatched->{status}, 'no_match', 'missing evidence is a non-fatal result' );
is_deeply( $unmatched->{matches}, [], 'missing evidence does not invent a match' );

my $no_candidate = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    $harness, $payload, { status => 'insufficient_evidence' } );
is( $no_candidate->{status}, 'not_checked', 'a response without a class candidate does not invoke evidence gating' );

my $invalid_candidate = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    $harness, $payload, { candidate => { value => 'NOT A CALL NUMBER!' } } );
is( $invalid_candidate->{status}, 'invalid_candidate',
    'invalid candidate is distinct from unavailable verification' );

my $full_call_number = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    $harness, $payload, { candidate => { value => 'QA76.73.J38 S65 2020' } } );
is( $full_call_number->{status}, 'verified',
    'full call number verifies through its longest exact schedule prefix' );
is( $full_call_number->{matches}[0]{matched_prefix}, 'QA76.73.J38',
    'verification identifies the exact schedule prefix rather than fabricating item evidence' );

for my $candidate (
    'PR6058.A528 H37 2003', 'HV6001 .H39', 'ML410 .B4',
    'K3150 .H38',           'Z665 .M37 2010', 'Z665 .M37 2010 COPY 2'
  )
{
    ok(
        Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_valid_lccs_candidate(
            $candidate),
        "$candidate is accepted as a complete LCC form"
    );
}
ok(
    !Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_valid_lccs_candidate(
        'QA76 ARTIFICIAL INTELLIGENCE'),
    'classification prose is not accepted as a local suffix'
);

{
    package Local::MissingLCCSHarness;
    sub new { bless {}, shift }
    sub get_plugin_dir { return '/path/that/does/not/exist' }
}
my $unavailable = Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(
    Local::MissingLCCSHarness->new, $payload,
    { candidate => { value => 'Z665' } } );
is( $unavailable->{status}, 'unavailable', 'missing runtime evidence degrades without rejecting the candidate' );
is( $unavailable->{candidate}, 'Z665', 'candidate survives unavailable evidence runtime' );

done_testing();
