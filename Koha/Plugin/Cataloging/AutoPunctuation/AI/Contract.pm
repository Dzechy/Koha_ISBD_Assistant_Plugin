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

    # No authority connector exists yet. A model cannot promote its own claim.
    if ( $task eq 'cataloging_classification' ) {
        $result->{authority_status} = 'unverified';
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
          if ref $result->{classification_candidate} eq 'HASH';
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
