# This file is part of Koha.

package Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract;

use Modern::Perl;
use JSON ();

our $SCHEMA_VERSION = '1.0.0';

my %SCHEMA_FILES = (
    punctuation_explanation   => 'ai_punctuation_explanation_v1.json',
    cataloging_classification => 'ai_cataloging_classification_v1.json',
    subject_heading_suggestion => 'ai_subject_heading_suggestion_v1.json',
    cataloging_review          => 'ai_cataloging_review_v1.json',
    training_tutor             => 'ai_training_tutor_v1.json',
);

sub _supported_ai_tasks { return [ sort keys %SCHEMA_FILES ]; }

sub _ai_task_schema_file {
    my ( $self, $task ) = @_;
    return $SCHEMA_FILES{ $task || '' } || '';
}

sub _ai_task_schema {
    my ( $self, $task ) = @_;
    my $file = _ai_task_schema_file( $self, $task );
    return {} unless $file;
    return $self->_load_schema($file);
}

sub _validate_ai_task_response {
    my ( $self, $payload, $result ) = @_;
    return ['AI response should be an object.'] unless ref $result eq 'HASH';
    my $task = $payload->{task} || '';
    my $file = _ai_task_schema_file( $self, $task );
    return ["Unsupported AI task: $task"] unless $file;
    my $errors = $self->_validate_schema( $file, $result );
    push @{$errors}, 'AI response task mismatch.'
      if ( $result->{task} || '' ) ne $task;

    if ( $task eq 'cataloging_classification' || $task eq 'cataloging_review' ) {
        my $candidate = $task eq 'cataloging_classification'
          ? $result->{candidate}
          : $result->{classification_candidate};
        if ( $task eq 'cataloging_classification'
            && $result->{status} eq 'ok' && ref $candidate ne 'HASH' ) {
            push @{$errors}, 'Classification response missing candidate.';
        }
        if ( ref $candidate eq 'HASH' ) {
            my $value = $candidate->{value} // '';
            push @{$errors}, 'Classification must be one class number, not a range.'
              if $value =~ /(?:\s[-–—]\s|\bto\b)/i;
            push @{$errors}, 'Classification contains invalid characters or terminal punctuation.'
              unless $value eq '' || $value =~ /^[A-Z]{1,3}\d+(?:\.\d+)?(?:\s+[A-Z]\d+(?:\.\d+)?)?$/;
        }
    }
    if ( $task eq 'subject_heading_suggestion' || $task eq 'cataloging_review' ) {
        my $candidates = $task eq 'subject_heading_suggestion'
          ? $result->{candidates}
          : $result->{subject_candidates};
        for my $candidate ( @{ $candidates || [] } ) {
            next unless ref $candidate eq 'HASH';
            for my $subdivision ( @{ $candidate->{subdivisions} || [] } ) {
                next unless ref $subdivision eq 'HASH';
                push @{$errors}, 'Invalid subject subdivision code.'
                  unless ( $subdivision->{code} || '' ) =~ /^[xyzv]$/;
            }
        }
    }
    return $errors;
}

sub _lccs_evidence_text {
    my ($match) = @_;
    return '' unless $match && ref $match eq 'HASH';
    my $candidate = $match->{candidate} || '';
    my $caption   = $match->{caption}   || '';
    my $source    = $match->{source_pdf} || 'LCC 2024 schedule';
    my $page      = $match->{page} || '';
    my $text = 'LCCS 2024 exact schedule match: ' . $candidate;
    $text .= ' — ' . $caption if $caption ne '';
    $text .= ' (' . $source . ( $page ne '' ? ", p. $page" : '' ) . ')';
    return substr( $text, 0, 400 );
}

sub _apply_lccs_evidence {
    my ( $task, $result, $verification ) = @_;
    return unless $verification && ref $verification eq 'HASH';
    my $status = $verification->{status} || 'unavailable';
    return if $status eq 'not_applicable';

    my $matches = ref $verification->{matches} eq 'ARRAY'
      ? $verification->{matches}
      : [];
    my @public_matches = @{$matches};
    splice @public_matches, 3 if @public_matches > 3;
    $result->{evidence_verification} = {
        status     => $status,
        source     => $verification->{source} || 'lccs-2024',
        candidate  => $verification->{candidate} || '',
        matches    => \@public_matches,
        validation => $verification->{validation} || {},
    };

    my $candidate =
        $task eq 'cataloging_classification' ? $result->{candidate}
      : $task eq 'cataloging_review'         ? $result->{classification_candidate}
      :                                        undef;
    return unless $candidate && ref $candidate eq 'HASH';

    if ( $status eq 'verified' && @{$matches} ) {
        my $text = _lccs_evidence_text( $matches->[0] );
        if ( $task eq 'cataloging_classification' ) {
            $result->{evidence} = []
              unless ref $result->{evidence} eq 'ARRAY';
            push @{ $result->{evidence} }, $text
              if $text ne '' && !grep { $_ eq $text } @{ $result->{evidence} };
            $result->{authority_status} = 'verified';
        }
        else {
            $candidate->{evidence} = []
              unless ref $candidate->{evidence} eq 'ARRAY';
            push @{ $candidate->{evidence} }, $text
              if $text ne '' && !grep { $_ eq $text } @{ $candidate->{evidence} };
            $candidate->{authority_status} = 'verified';
        }
        return;
    }

    my $value = $verification->{candidate} || $candidate->{value} || '';
    my $warning = $status eq 'no_match'
      ? "No exact lccs-2024 schedule entry verified $value; the AI suggestion is still shown for cataloguer review."
      : 'LCCS evidence was unavailable; the AI suggestion is still shown as unverified for cataloguer review.';
    push @{ $result->{warnings} }, $warning
      unless grep { $_ eq $warning } @{ $result->{warnings} };
}

sub _normalize_ai_task_response {
    my ( $self, $payload, $result, $provider_meta ) = @_;
    $provider_meta ||= {};
    my $task = $payload->{task} || '';
    $result->{schema_version} = $SCHEMA_VERSION;
    $result->{task}           = $task;
    $result->{request_id}     = $payload->{request_id};
    $result->{warnings}       = [] unless ref $result->{warnings} eq 'ARRAY';
    $result->{evidence}       = []
      if $task eq 'cataloging_classification'
      && ref $result->{evidence} ne 'ARRAY';
    $result->{requires_human_review} = JSON::true;

    _apply_lccs_evidence(
        $task, $result,
        $provider_meta->{lccs_evidence}
    );

    # A model cannot promote its own claim. Only the server-side LCCS adapter
    # can verify that a returned classification exists in the 2024 schedule.
    if ( $task eq 'cataloging_classification' ) {
        $result->{authority_status} = 'unverified'
          unless ( $result->{authority_status} || '' ) eq 'verified';
        if ( ref $result->{candidate} eq 'HASH' ) {
            my $evidence_count = scalar @{ $result->{evidence} || [] };
            $result->{candidate}{confidence} =
                $result->{status} eq 'insufficient_evidence' ? 'insufficient_evidence'
              : $evidence_count >= 2                         ? 'medium'
              :                                               'low';
        }
    }
    if ( $task eq 'subject_heading_suggestion' ) {
        for my $candidate ( @{ $result->{candidates} || [] } ) {
            if ( ref $candidate eq 'HASH' ) {
                $candidate->{authority_status} = 'unverified';
                my $evidence_count = scalar @{ $candidate->{evidence} || [] };
                $candidate->{confidence} = $evidence_count >= 2 ? 'medium' : 'low';
            }
        }
    }
    if ( $task eq 'cataloging_review' ) {
        $result->{classification_candidate}{authority_status} = 'unverified'
          if ref $result->{classification_candidate} eq 'HASH'
          && ( $result->{classification_candidate}{authority_status} || '' ) ne 'verified';
        if ( ref $result->{classification_candidate} eq 'HASH' ) {
            my $evidence_count = scalar @{ $result->{classification_candidate}{evidence} || [] };
            $result->{classification_candidate}{confidence} = $evidence_count >= 2 ? 'medium' : 'low';
        }
        for my $candidate ( @{ $result->{subject_candidates} || [] } ) {
            if ( ref $candidate eq 'HASH' ) {
                $candidate->{authority_status} = 'unverified';
                my $evidence_count = scalar @{ $candidate->{evidence} || [] };
                $candidate->{confidence} = $evidence_count >= 2 ? 'medium' : 'low';
            }
        }
        for my $finding ( @{ $result->{findings} || [] } ) {
            $finding->{authority_status} = 'unverified'
              if ref $finding eq 'HASH'
              && ( $finding->{authority_status} || '' ) ne 'not_applicable';
        }
    }
    if ( $provider_meta->{truncated} ) {
        $result->{status} = 'incomplete';
        push @{ $result->{warnings} }, 'Provider output was truncated and must not be applied.';
    }
    $result->{provider} = $provider_meta->{provider} if $provider_meta->{provider};
    $result->{model}    = $provider_meta->{model}    if $provider_meta->{model};
    return $result;
}

1;
