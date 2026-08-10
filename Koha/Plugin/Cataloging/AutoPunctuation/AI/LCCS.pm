# This file is part of Koha.

package Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS;

use Modern::Perl;
use File::Spec;
use IPC::Open3;
use JSON qw(from_json to_json);
use Symbol qw(gensym);

our $PACKAGE_VERSION = '1.1.0';

sub _lccs_candidate_from_result {
    my ( $payload, $result ) = @_;
    return '' unless $payload && $result && ref $result eq 'HASH';
    my $task = $payload->{task} || '';
    my $candidate =
        $task eq 'cataloging_classification' ? $result->{candidate}
      : $task eq 'cataloging_review'         ? $result->{classification_candidate}
      :                                        undef;
    return '' unless $candidate && ref $candidate eq 'HASH';
    my $value = uc( $candidate->{value} || '' );
    $value =~ s/^\s+|\s+$//g;
    return '' unless $value =~ /^[A-Z]{1,3}\d+(?:\.\d+)?(?:\s+[A-Z]\d+(?:\.\d+)?)?$/;
    return $value;
}

sub _lccs_evidence_script {
    my ($self) = @_;
    return '' unless $self && $self->can('get_plugin_dir');
    return File::Spec->catfile(
        $self->get_plugin_dir(), 'scripts', 'lccs_evidence.js' );
}

sub _query_lccs_evidence {
    my ( $self, $candidates ) = @_;
    $candidates = [] unless $candidates && ref $candidates eq 'ARRAY';
    my $script = _lccs_evidence_script($self);
    return { available => 0, status => 'unavailable' }
      unless $script && -f $script;

    my ( $pid, $writer, $reader );
    my $stderr = gensym;
    my ( $stdout, $error_text, $exit_code ) = ( '', '', 1 );
    my @bounded_candidates = @{$candidates};
    splice @bounded_candidates, 3 if @bounded_candidates > 3;
    my $ok = eval {
        local $SIG{ALRM} = sub { die "LCCS evidence query timed out\n" };
        alarm 8;
        $pid = open3( $writer, $reader, $stderr, 'node', $script );
        print {$writer} to_json( { candidates => \@bounded_candidates } );
        close $writer;
        local $/;
        $stdout     = <$reader> // '';
        $error_text = <$stderr> // '';
        close $reader;
        close $stderr;
        waitpid( $pid, 0 );
        $exit_code = $? >> 8;
        alarm 0;
        1;
    };
    alarm 0;
    if ( !$ok ) {
        if ($pid) {
            kill 'TERM', $pid;
            waitpid( $pid, 0 );
        }
        return { available => 0, status => 'unavailable' };
    }

    my $decoded = eval { from_json($stdout) };
    return { available => 0, status => 'unavailable' }
      unless $decoded && ref $decoded eq 'HASH' && $decoded->{available};
    return $decoded;
}

sub _verify_lccs_result {
    my ( $self, $payload, $result ) = @_;
    my $candidate = _lccs_candidate_from_result( $payload, $result );
    return {
        status  => 'not_applicable',
        source  => 'lccs-2024@' . $PACKAGE_VERSION,
        matches => []
      }
      unless $candidate;

    my $evidence = _query_lccs_evidence( $self, [$candidate] );
    return {
        status    => 'unavailable',
        source    => 'lccs-2024@' . $PACKAGE_VERSION,
        candidate => $candidate,
        matches   => []
      }
      unless $evidence->{available};

    my $check = $evidence->{checks} && ref $evidence->{checks} eq 'ARRAY'
      ? $evidence->{checks}[0]
      : undef;
    my $matches = $check && ref $check->{matches} eq 'ARRAY'
      ? $check->{matches}
      : [];
    return {
        status     => $check && ( $check->{status} || '' ) eq 'verified'
        ? 'verified'
        : 'no_match',
        source     => $evidence->{source} || 'lccs-2024@' . $PACKAGE_VERSION,
        candidate  => $candidate,
        matches    => $matches,
        validation => $evidence->{validation} || {},
    };
}

1;
