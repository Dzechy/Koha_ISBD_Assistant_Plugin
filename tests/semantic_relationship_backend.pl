# This file is part of Koha.
#
# Copyright (C) 2025 Duke Chijimaka Jonathan
#
# Koha is free software; you can redistribute it and/or modify it under the
# terms of the GNU General Public License as published by the Free Software
# Foundation; either version 3 of the License, or (at your option) any later
# version.

use Modern::Perl;
use utf8;
use open qw(:std :encoding(UTF-8));
use Test::More;
use FindBin qw($Bin);
use File::Spec;
use JSON qw(from_json);

BEGIN {
    package C4::Context;
    $INC{'C4/Context.pm'} = 1;
}

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::Rules;
use Koha::Plugin::Cataloging::AutoPunctuation::Api ();

my $root = File::Spec->catdir( $Bin, '..' );
my $rules_path = File::Spec->catfile(
    $root, 'Koha', 'Plugin', 'Cataloging', 'AutoPunctuation',
    'rules', 'isbd_baseline.json'
);
open my $fh, '<:encoding(UTF-8)', $rules_path
  or die "Cannot open $rules_path: $!";
my $pack = from_json( do { local $/; <$fh> } );
close $fh;

my $engine = bless {}, 'Koha::Plugin::Cataloging::AutoPunctuation::Rules';

is_deeply(
    [
        map { $_->{code} }
          Koha::Plugin::Cataloging::AutoPunctuation::Api::_semantic_subfields(
            '245',
            [
                { code => 'c', value => 'Author' },
                { code => 'b', value => 'Subtitle' },
                { code => 'a', value => 'Title' },
            ],
            $pack
          )
    ],
    [qw(a b c)],
    'AI/cache helper uses semantic subfield order'
);
is(
    Koha::Plugin::Cataloging::AutoPunctuation::Api::_semantic_primary_subfield(
        '245',
        [
            { code => 'c', value => 'Author' },
            { code => 'a', value => '   ' },
            { code => 'b', value => 'Subtitle' },
        ],
        $pack
    ),
    'b',
    'AI fallback selects the first active semantic role, not array element zero'
);

sub findings_for {
    my ($field) = @_;
    return $engine->_validate_field_with_rules( $field, $pack, {} )->{findings}
      || [];
}

sub permutations {
    my ($items) = @_;
    return [ [ @{$items} ] ] if @{$items} < 2;
    my @out;
    for my $i ( 0 .. $#{$items} ) {
        my @rest = @{$items};
        my $item = splice @rest, $i, 1;
        push @out, map { [ $item, @{$_} ] } @{ permutations(\@rest) };
    }
    return \@out;
}

sub normalized_values {
    my ($field) = @_;
    my @subs = map { { %{$_} } } @{ $field->{subfields} || [] };
    my $copy = { %{$field}, subfields => \@subs };
    for my $finding ( @{ findings_for($copy) } ) {
        my $index = $finding->{subfield_index};
        next unless defined $index && $copy->{subfields}[$index];
        $copy->{subfields}[$index]{value} = $finding->{expected_value};
    }
    return $copy;
}

sub semantic_signature {
    my ($field) = @_;
    my $normalized = normalized_values($field);
    my %occurrence;
    my @values = sort map {
        my $code = $_->{code} || '';
        my $key = $code . '@' . ( $occurrence{$code}++ || 0 );
        $key . '=' . ( $_->{value} // '' )
    } @{ $normalized->{subfields} || [] };
    return join "\x1e", @values;
}

sub assert_permutation_invariant {
    my ( $name, $field ) = @_;
    my $expected = semantic_signature($field);
    my $number = 0;
    for my $subfields ( @{ permutations( $field->{subfields} ) } ) {
        my $candidate = { %{$field}, subfields => $subfields };
        is( semantic_signature($candidate), $expected,
            "$name permutation " . ++$number );
    }
}

my %title_value = (
    a => 'The Great Gatsby',
    b => 'A Novel',
    c => 'F. Scott Fitzgerald',
    n => 'Part 1',
    p => 'Poems',
);
for my $codes (
    [qw(a b c)],
    [qw(a n p c)],
    [qw(a b n p c)],
  )
{
    assert_permutation_invariant(
        '245 ' . join( '', @{$codes} ),
        {
            tag       => '245',
            subfields => [ map { { code => $_, value => $title_value{$_} } } @{$codes} ],
        }
    );
}

for my $field (
    {
        tag       => '250',
        subfields => [
            { code => 'a', value => '2nd ed.' },
            { code => 'b', value => 'revised' },
        ],
    },
    {
        tag       => '260',
        subfields => [
            { code => 'a', value => 'London' },
            { code => 'b', value => 'Penguin' },
            { code => 'c', value => '2020' },
        ],
    },
    {
        tag       => '264', ind2 => '1',
        subfields => [
            { code => 'a', value => 'London' },
            { code => 'b', value => 'Penguin' },
            { code => 'c', value => '2020' },
        ],
    },
    {
        tag       => '300',
        subfields => [
            { code => 'a', value => '250 pages' },
            { code => 'b', value => 'illustrations' },
            { code => 'c', value => '24 cm' },
            { code => 'e', value => '1 booklet' },
        ],
    },
    {
        tag       => '490',
        subfields => [
            { code => 'a', value => 'Series title' },
            { code => 'x', value => '1234-5678' },
            { code => 'v', value => 'volume 3' },
        ],
    },
    {
        tag       => '255',
        subfields => [
            { code => 'a', value => 'Scale 1:25000' },
            { code => 'b', value => 'Conic proj.' },
            { code => 'c', value => '(W 10°--W 5°/N 8°--N 2°)' },
        ],
    },
  )
{
    assert_permutation_invariant( $field->{tag}, $field );
}

my $title = {
    tag       => '245', ind1 => '1', ind2 => '4', occurrence => 2,
    subfields => [
        { code => 'c', value => 'Author' },
        { code => 'b', value => 'Subtitle' },
        { code => 'a', value => 'Title' },
    ],
};

my $generated_subtitle_finding = findings_for(
    {
        tag       => '245',
        subfields => [ { code => 'b', value => 'a novel' } ],
    }
)->[0];
is(
    $generated_subtitle_finding->{punctuation_provenance}{source},
    'plugin',
    'backend marks generated punctuation provenance'
);
is(
    $generated_subtitle_finding->{punctuation_provenance}{generated_suffix},
    '.',
    'backend records the generated suffix'
);
my $generated_subtitle = {
    code                   => 'b',
    value                  => $generated_subtitle_finding->{expected_value},
    punctuation_provenance => $generated_subtitle_finding->{punctuation_provenance},
};
my ($subtitle_transition) = grep { $_->{subfield} eq 'b' } @{ findings_for(
    {
        tag       => '245',
        subfields => [ $generated_subtitle, { code => 'c', value => 'Author' } ],
    }
) };
is(
    $subtitle_transition->{expected_value},
    'a novel',
    'backend removes a plugin-generated period when related 245$c appears'
);

my $once = normalized_values($title);
my $twice = normalized_values($once);
is_deeply( $twice, $once, 'backend normalization is idempotent' );
is_deeply(
    [ map { $_->{code} } @{ $once->{subfields} } ],
    [qw(c b a)],
    'backend preserves physical MARC subfield order'
);
is( $once->{ind1}, '1', 'first indicator is preserved' );
is( $once->{ind2}, '4', 'second indicator is preserved' );
is( $once->{occurrence}, 2, 'field occurrence is preserved' );

my $repeated = normalized_values(
    {
        tag       => '260',
        subfields => [
            { code => 'c', value => '1925' },
            { code => 'a', value => 'New York' },
            { code => 'a', value => 'Chicago' },
        ],
    }
);
is_deeply(
    [ map { $_->{value} } grep { $_->{code} eq 'a' } @{ $repeated->{subfields} } ],
    [ 'New York ;', 'Chicago,' ],
    'repeated subfield occurrence order remains meaningful'
);

done_testing();
