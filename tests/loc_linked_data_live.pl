use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC;

plan skip_all => 'Set LOC_LIVE_TEST=1 to query the external LOC service.'
  unless $ENV{LOC_LIVE_TEST};

my $adapter = bless { _authority_cache_backend => undef }, 'Local::LiveLOCHarness';
my $result =
  Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::search_lcsh(
    $adapter, 'Artificial intelligence',
    { loc_authority_timeout_seconds => 12 }, { force => 1 } );

is( $result->{status}, 'exact_authorized', 'live LOC response verifies a known LCSH heading' );
is( $result->{match_type}, 'exact_authorized', 'live LOC response is an exact authorized match' );
is( $result->{authorized_heading}, 'Artificial intelligence', 'live authorized label is preserved' );
like( $result->{uri} || '', qr{^https://id\.loc\.gov/authorities/subjects/sh\d+$},
    'live authority URI is controlled and HTTPS' );

my $record =
  Koha::Plugin::Cataloging::AutoPunctuation::AI::LinkedData::LOC::get_lcsh_record(
    $adapter, $result->{uri}, { loc_authority_timeout_seconds => 12 } );
is( $record->{heading}, 'Artificial intelligence',
    'live JSON-LD authority record is normalized inside the adapter' );
ok( !exists $record->{graph}, 'live raw JSON-LD graph is not exposed' );

done_testing();
