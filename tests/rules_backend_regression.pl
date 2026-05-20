use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));
use Test::More;
use FindBin qw($Bin);
use File::Spec;
use JSON qw(from_json);

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::Rules;

binmode STDOUT, ':encoding(UTF-8)';
binmode STDERR, ':encoding(UTF-8)';

my $root = File::Spec->catdir( $Bin, '..' );
my $rules_path =
  File::Spec->catfile( $root,
    'Koha', 'Plugin', 'Cataloging', 'AutoPunctuation', 'rules',
    'isbd_baseline.json' );
open my $fh, '<', $rules_path or die "Cannot open $rules_path: $!";
my $json = do { local $/; <$fh> };
close $fh;

my $pack     = from_json($json);
my $engine   = bless {}, 'Koha::Plugin::Cataloging::AutoPunctuation::Rules';
my $settings = {};

sub findings_for {
    my ($field) = @_;
    my $payload = {
        ind1       => '',
        ind2       => '',
        occurrence => 0,
        %{$field},
    };
    return $engine->_validate_field_with_rules( $payload, $pack, $settings )
      ->{findings} || [];
}

sub expected_map {
    my ($field) = @_;
    my %out;
    for my $finding ( @{ findings_for($field) } ) {
        $out{
            join( '',
                $finding->{tag}, '$', $finding->{subfield},
                '@', $finding->{subfield_index} )
          }
          = $finding->{expected_value};
    }
    return \%out;
}

sub assert_expected {
    my ( $name, $field, $expected ) = @_;
    my $map = expected_map($field);
    for my $key ( sort keys %{$expected} ) {
        is( $map->{$key}, $expected->{$key}, "$name: $key expected value" );
    }
}

sub assert_no_expected {
    my ( $name, $field, $key ) = @_;
    my $map = expected_map($field);
    ok( !exists $map->{$key}, "$name: $key should not produce a finding" );
}

sub count_findings {
    my ( $field, $code ) = @_;
    my $count = 0;
    for my $finding ( @{ findings_for($field) } ) {
        $count++ if ( $finding->{code} || '' ) eq $code;
    }
    return $count;
}

sub assert_no_severity {
    my ( $name, $field, $severity ) = @_;
    my $count = 0;
    for my $finding ( @{ findings_for($field) } ) {
        $count++ if ( $finding->{severity} || '' ) eq $severity;
    }
    is( $count, 0, "$name: no $severity findings" );
}

my $fixtures_path =
  File::Spec->catfile( $root, 't', 'fixtures', 'isbd_punctuation_cases.json' );
open my $fixtures_fh, '<', $fixtures_path
  or die "Cannot open $fixtures_path: $!";
my $fixtures_json = do { local $/; <$fixtures_fh> };
close $fixtures_fh;
my $shared_fixtures = from_json($fixtures_json);

for my $case ( @{$shared_fixtures} ) {
    my $findings = findings_for( $case->{field} );
    for my $expected ( @{ $case->{expected} || [] } ) {
        my $ok = 0;
        for my $finding ( @{$findings} ) {
            if ( ( $finding->{subfield} || '' ) eq
                   ( $expected->{subfield} || '' )
                && ( $finding->{expected_value} || '' ) eq
                ( $expected->{value} || '' ) )
            {
                $ok = 1;
                last;
            }
        }
        ok( $ok,
"$case->{name}: $case->{field}{tag}\$$expected->{subfield} expected $expected->{value}"
        );
    }
}

assert_expected(
    '245 a+c',
    {
        tag       => '245',
        subfields => [
            { code => 'a', value => 'The great gatsby' },
            { code => 'c', value => 'by Fitzgerald' },
        ],
    },
    { '245$c@1' => ' / by Fitzgerald.' }
);
assert_no_expected(
    '245 a+c',
    {
        tag       => '245',
        subfields => [
            { code => 'a', value => 'The great gatsby' },
            { code => 'c', value => 'by Fitzgerald' },
        ],
    },
    '245$a@0'
);

assert_expected(
    '245 b only',
    {
        tag       => '245',
        subfields => [ { code => 'b', value => ': a novel' } ],
    },
    { '245$b@0' => 'a novel.' }
);
assert_no_severity(
    '245 b only',
    {
        tag       => '245',
        subfields => [ { code => 'b', value => ': a novel' } ],
    },
    'ERROR'
);

assert_expected(
    '245 c only',
    {
        tag       => '245',
        subfields => [ { code => 'c', value => '/ by Fitzgerald' } ],
    },
    { '245$c@0' => 'by Fitzgerald.' }
);
assert_expected(
    '245 n only',
    {
        tag       => '245',
        subfields => [ { code => 'n', value => '. Part 1' } ],
    },
    { '245$n@0' => 'Part 1.' }
);
assert_expected(
    '245 p only',
    {
        tag       => '245',
        subfields => [ { code => 'p', value => ', Poems' } ],
    },
    { '245$p@0' => 'Poems.' }
);
assert_expected(
    '245 b+c',
    {
        tag       => '245',
        subfields => [
            { code => 'b', value => 'a novel' },
            { code => 'c', value => 'by Fitzgerald' },
        ],
    },
    { '245$c@1' => ' / by Fitzgerald.' }
);
assert_expected(
    '245 n+p',
    {
        tag       => '245',
        subfields => [
            { code => 'n', value => 'Part 1' },
            { code => 'p', value => 'Poems' },
        ],
    },
    { '245$p@1' => ', Poems.' }
);
assert_no_expected(
    '245 n+p',
    {
        tag       => '245',
        subfields => [
            { code => 'n', value => 'Part 1' },
            { code => 'p', value => 'Poems' },
        ],
    },
    '245$n@0'
);

assert_expected(
    '300 a+b+c',
    {
        tag       => '300',
        subfields => [
            { code => 'a', value => 'xii, 180 pages' },
            { code => 'b', value => ': illustrations' },
            { code => 'c', value => '; 23 cm' },
        ],
    },
    {
        '300$a@0' => 'xii, 180 pages :',
        '300$b@1' => 'illustrations ;',
        '300$c@2' => '23 cm.',
    }
);

assert_expected(
    '300 a roman only',
    {
        tag       => '300',
        subfields => [ { code => 'a', value => 'xii pages :' } ],
    },
    { '300$a@0' => 'xii pages.' }
);
assert_expected(
    '300 a arabic only',
    {
        tag       => '300',
        subfields => [ { code => 'a', value => '180 pages ;' } ],
    },
    { '300$a@0' => '180 pages.' }
);
assert_expected(
    '300 a mixed only',
    {
        tag       => '300',
        subfields => [ { code => 'a', value => 'xii, 180 pages :' } ],
    },
    { '300$a@0' => 'xii, 180 pages.' }
);
assert_expected(
    '300 b only',
    {
        tag       => '300',
        subfields => [ { code => 'b', value => ': illustrations' } ],
    },
    { '300$b@0' => 'illustrations.' }
);
assert_expected(
    '300 c only',
    {
        tag       => '300',
        subfields => [ { code => 'c', value => '; 23 cm' } ],
    },
    { '300$c@0' => '23 cm.' }
);
assert_expected(
    '300 e only',
    {
        tag       => '300',
        subfields => [ { code => 'e', value => '+ 1 booklet' } ],
    },
    { '300$e@0' => '1 booklet.' }
);
assert_expected(
    '300 b+e',
    {
        tag       => '300',
        subfields => [
            { code => 'b', value => 'illustrations' },
            { code => 'e', value => '1 booklet' },
        ],
    },
    { '300$b@0' => 'illustrations + ', '300$e@1' => '1 booklet.' }
);
assert_expected(
    '300 c+e',
    {
        tag       => '300',
        subfields => [
            { code => 'c', value => '23 cm' },
            { code => 'e', value => '1 booklet' },
        ],
    },
    { '300$c@0' => '23 cm + ', '300$e@1' => '1 booklet.' }
);
assert_no_severity(
    '300 sparse vendor',
    {
        tag       => '300',
        subfields => [
            { code => 'b', value => ': illustrations' },
            { code => 'c', value => '; 23 cm' },
            { code => 'e', value => '+ 1 booklet' },
        ],
    },
    'ERROR'
);

assert_expected(
    '260 repeated a',
    {
        tag       => '260',
        subfields => [
            { code => 'a', value => 'New York' },
            { code => 'a', value => 'Chicago' },
            { code => 'c', value => '1925' },
        ],
    },
    {
        '260$a@0' => 'New York,',
        '260$a@1' => ' ; Chicago,',
    }
);

assert_expected(
    '260 b only',
    {
        tag       => '260',
        subfields => [ { code => 'b', value => ': Scribner' } ],
    },
    { '260$b@0' => 'Scribner.' }
);
assert_expected(
    '260 c only',
    {
        tag       => '260',
        subfields => [ { code => 'c', value => ', 1925' } ],
    },
    { '260$c@0' => '1925.' }
);
assert_expected(
    '264 repeated a',
    {
        tag       => '264',
        subfields => [
            { code => 'a', value => 'London' },
            { code => 'a', value => 'New York' },
            { code => 'c', value => '2020' },
        ],
    },
    {
        '264$a@0' => 'London,',
        '264$a@1' => ' ; New York,',
    }
);
assert_no_severity(
    '260 sparse vendor',
    {
        tag       => '260',
        subfields => [
            { code => 'b', value => ': Vendor publisher' },
            { code => 'c', value => ', 1999' },
        ],
    },
    'ERROR'
);

assert_expected(
    '250 a+b',
    {
        tag       => '250',
        subfields => [
            { code => 'a', value => '2nd ed.' },
            { code => 'b', value => 'revised' },
        ],
    },
    { '250$b@1' => 'revised.' }
);
assert_expected(
    '254 score',
    {
        tag       => '254',
        subfields => [ { code => 'a', value => 'Full score' } ],
    },
    { '254$a@0' => 'Full score.' }
);

assert_expected(
    '264 copyright date',
    {
        tag       => '264',
        ind2      => '4',
        subfields => [ { code => 'c', value => '©2020' } ],
    },
    { '264$c@0' => '©2020.' }
);
assert_no_severity(
    '264 copyright a/b handoff',
    {
        tag       => '264',
        ind2      => '4',
        subfields => [
            { code => 'a', value => 'Place' },
            { code => 'b', value => 'Name' },
        ],
    },
    'ERROR'
);
assert_no_expected(
    '264 copyright a handoff',
    {
        tag       => '264',
        ind2      => '4',
        subfields => [
            { code => 'a', value => 'Place' },
            { code => 'b', value => 'Name' },
        ],
    },
    '264$a@0'
);
assert_no_expected(
    '264 copyright b handoff',
    {
        tag       => '264',
        ind2      => '4',
        subfields => [
            { code => 'a', value => 'Place' },
            { code => 'b', value => 'Name' },
        ],
    },
    '264$b@1'
);

assert_no_expected(
    'blank subfield absent',
    {
        tag       => '245',
        subfields => [
            { code => 'a', value => 'Sparse title' },
            { code => 'b', value => '   ' },
            { code => 'c', value => 'by Someone' },
        ],
    },
    '245$b@1'
);

assert_expected(
    '255 ratio colon',
    {
        tag       => '255',
        subfields => [ { code => 'a', value => 'Scale 1:25000' } ],
    },
    { '255$a@0' => 'Scale 1:25000.' }
);
assert_no_severity(
    '255 coordinate handoff',
    {
        tag       => '255',
        subfields =>
          [ { code => 'c', value => '(W 131°--W 59°/N 53°--N 38°)' } ],
    },
    'ERROR'
);

assert_expected(
    '362 closed serial numbering',
    {
        tag       => '362',
        subfields => [
            {
                code  => 'a',
                value => 'Vol. 1, no. 1 (Jan. 1971)-vol. 5, no. 12 (Dec. 1975)'
            }
        ],
    },
    { '362$a@0' => 'Vol. 1, no. 1 (Jan. 1971)-vol. 5, no. 12 (Dec. 1975).' }
);
assert_no_expected(
    '362 open serial numbering',
    {
        tag       => '362',
        subfields => [ { code => 'a', value => 'Vol. 1, no. 1 (Jan. 1971)-' } ],
    },
    '362$a@0'
);

assert_expected(
    '490 series issn',
    {
        tag       => '490',
        subfields => [ { code => 'x', value => '0080-2258.' } ],
    },
    { '490$x@0' => '0080-2258' }
);

is(
    count_findings(
        {
            tag       => '020',
            subfields => [ { code => 'a', value => '978-3-16-148410-0.' } ],
        },
        'ISBD_ISBN_020'
    ),
    1,
    '020$a uses the specific ISBN rule'
);
is(
    count_findings(
        {
            tag       => '020',
            subfields => [ { code => 'a', value => '978-3-16-148410-0.' } ],
        },
        'ISBD_STDNUM_NO_PUNCT_001'
    ),
    0,
    '020$a suppresses the generic standard-number rule'
);
is(
    count_findings(
        {
            tag       => '024',
            subfields => [ { code => 'a', value => '123456789.' } ],
        },
        'ISBD_STDNUM_NO_PUNCT_001'
    ),
    1,
    '024$a still uses the generic standard-number rule'
);
assert_expected(
    '022 issn',
    {
        tag       => '022',
        subfields => [ { code => 'a', value => '0024-2667.' } ],
    },
    { '022$a@0' => '0024-2667' }
);
assert_expected(
    '028 publisher number',
    {
        tag       => '028',
        subfields => [ { code => 'a', value => 'ABC-123.' } ],
    },
    { '028$a@0' => 'ABC-123' }
);

is(
    count_findings(
        {
            tag       => '500',
            subfields => [ { code => 'a', value => 'Includes index' } ],
        },
        'ISBD_NOTES_500A_001'
    ),
    1,
    '500$a uses the specific note rule'
);
is(
    count_findings(
        {
            tag       => '500',
            subfields => [ { code => 'a', value => 'Includes index' } ],
        },
        'ISBD_OTHER_ED_NOTE_500'
    ),
    0,
    '500$a suppresses generic 500 fallback'
);
is(
    count_findings(
        {
            tag       => '500',
            subfields => [ { code => 'a', value => 'Includes index' } ],
        },
        'ISBD_NOTES_GENERAL_5XX_A'
    ),
    0,
    '500$a suppresses generic 5XX fallback'
);

assert_expected(
    '504 bibliography note',
    {
        tag       => '504',
        subfields =>
          [ { code => 'a', value => 'Includes bibliographical references' } ],
    },
    { '504$a@0' => 'Includes bibliographical references.' }
);
assert_expected(
    '520 summary note',
    {
        tag       => '520',
        subfields => [ { code => 'a', value => 'A story of love and loss' } ],
    },
    { '520$a@0' => 'A story of love and loss.' }
);

assert_no_severity(
    '336 content type handoff',
    {
        tag       => '336',
        subfields => [ { code => 'a', value => 'text.' } ],
    },
    'ERROR'
);
assert_no_severity(
    '337 media type handoff',
    {
        tag       => '337',
        subfields => [ { code => 'a', value => 'unmediated.' } ],
    },
    'ERROR'
);
assert_no_severity(
    '338 carrier type handoff',
    {
        tag       => '338',
        subfields => [ { code => 'a', value => 'volume.' } ],
    },
    'ERROR'
);
assert_no_severity(
    '830 tracing handoff',
    {
        tag       => '830',
        subfields => [ { code => 'a', value => 'Library of America ; 1' } ],
    },
    'ERROR'
);
assert_no_severity(
    '856 url handoff',
    {
        tag       => '856',
        subfields =>
          [ { code => 'u', value => 'https://example.org/resource?id=1.' } ],
    },
    'ERROR'
);

my $schema_errors = $engine->_validate_custom_rules(
    {
        rules => [
            {
                id        => 'LOCAL_300A',
                tag       => '300',
                subfields => ['a'],
                checks    => [
                    {
                        type        => 'punctuation',
                        suffix      => '.',
                        suffix_mode => 'always',
                        severity    => 'INFO',
                    },
                ],
            },
        ],
    }
);
is( scalar @{$schema_errors},
    0, 'custom rule schema accepts narrow punctuation rule' );

my $bad_schema_errors = $engine->_validate_custom_rules(
    {
        rules => [
            {
                id          => 'LOCAL_BAD',
                tag_pattern => '(a+)+',
                subfields   => 'a',
                checks      => [ { type => 'rewrite_everything' } ],
            },
        ],
    }
);
ok( scalar @{$bad_schema_errors} >= 3,
    'custom rule schema rejects unsafe invalid rule shape' );

done_testing();
