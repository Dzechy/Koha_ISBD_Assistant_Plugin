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
is( $no_candidate->{status}, 'not_applicable', 'a response without a class candidate does not invoke evidence gating' );

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
