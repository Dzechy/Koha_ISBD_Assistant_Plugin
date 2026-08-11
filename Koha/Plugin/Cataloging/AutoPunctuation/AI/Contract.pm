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

sub _bounded_text {
    my ( $value, $limit ) = @_;
    return '' if !defined $value || ref $value;
    my $text = "$value";
    $text =~ s/^\s+|\s+$//g;
    $limit ||= 400;
    return substr( $text, 0, $limit );
}

sub _string_list {
    my ( $value, $limit, $item_limit ) = @_;
    return [] unless ref $value eq 'ARRAY';
    $limit      ||= 12;
    $item_limit ||= 400;
    my @items;
    for my $item ( @{$value} ) {
        last if @items >= $limit;
        my $text = _bounded_text( $item, $item_limit );
        push @items, $text if $text ne '';
    }
    return \@items;
}

sub _confidence_label {
    my ($value) = @_;
    my $label = lc( _bounded_text( $value, 80 ) );
    return $label if $label =~ /^(?:high|medium|low|insufficient_evidence)$/;
    return 'insufficient_evidence' if $label =~ /insufficient|unknown|none/;
    if ( $label =~ /([0-9]+(?:\.[0-9]+)?)/ ) {
        my $number = $1 + 0;
        $number /= 100 if $number > 1;
        return $number >= 0.8 ? 'high' : $number >= 0.5 ? 'medium' : 'low';
    }
    return 'low';
}

sub _classification_candidate {
    my ($result) = @_;
    my $source =
         ref $result->{candidate} eq 'HASH'                ? $result->{candidate}
      : ref $result->{classification_candidate} eq 'HASH' ? $result->{classification_candidate}
      : ref $result->{classification} eq 'HASH'           ? $result->{classification}
      :                                                       undef;
    my $value = $source
      ? ( $source->{value} // $source->{number} // $source->{call_number} // '' )
      : ( $result->{classification} // $result->{lcc} // $result->{call_number} // '' );

    if ( !ref $result->{findings} && !$value ) {
        $value = '';
    }
    if ( !$value && ref $result->{findings} eq 'ARRAY' ) {
        for my $finding ( @{ $result->{findings} } ) {
            next unless ref $finding eq 'HASH';
            my $code = uc( _bounded_text( $finding->{code}, 80 ) );
            next unless $code =~ /CLASSIFICATION|CALL_NUMBER|\bLCC\b/;
            $value = $finding->{value} // $finding->{message} // '';
            $source ||= $finding;
            last;
        }
    }
    $value = uc( _bounded_text( $value, 64 ) );
    $value =~ s/\s+/ /g;
    return undef
      unless $value =~ /^[A-Z]{1,3}\d+(?:\.\d+)?(?:\s+[A-Z]\d+(?:\.\d+)?)?$/;

    $source ||= {};
    my $basis = _bounded_text(
        $source->{basis} // $source->{rationale} // $source->{explanation}
          // $result->{rationale} // $result->{explanation}
          // 'Candidate inferred from the supplied catalogue evidence.',
        1200
    );
    return {
        value      => $value,
        confidence => _confidence_label(
            $source->{confidence} // $source->{model_confidence}
              // $result->{confidence}
        ),
        basis => $basis,
        ( _bounded_text( $source->{model_confidence}, 80 ) ne ''
            ? ( model_confidence => _bounded_text( $source->{model_confidence}, 80 ) )
            : () ),
    };
}

sub _subject_candidates {
    my ($result) = @_;
    my $raw =
         ref $result->{candidates} eq 'ARRAY'          ? $result->{candidates}
      : ref $result->{subject_candidates} eq 'ARRAY'  ? $result->{subject_candidates}
      : ref $result->{subjects} eq 'ARRAY'            ? $result->{subjects}
      :                                                  [];
    if ( !@{$raw} && ref $result->{findings} eq 'ARRAY' ) {
        my @legacy;
        for my $finding ( @{ $result->{findings} } ) {
            next unless ref $finding eq 'HASH';
            my $code = uc( _bounded_text( $finding->{code}, 80 ) );
            next unless $code =~ /SUBJECT|LCSH/;
            my $text = _bounded_text(
                $finding->{value} // $finding->{message} // '', 2400 );
            push @legacy, grep { $_ ne '' }
              map { _bounded_text( $_, 240 ) } split( /[;\n|]+/, $text );
        }
        $raw = \@legacy if @legacy;
    }
    my @candidates;
    for my $source ( @{$raw} ) {
        last if @candidates >= 10;
        my $heading = ref $source eq 'HASH'
          ? ( $source->{heading} // $source->{value} // $source->{subject} // '' )
          : $source;
        $heading = _bounded_text( $heading, 240 );
        next if $heading eq '';
        my @subdivisions;
        if ( ref $source eq 'HASH' && ref $source->{subdivisions} eq 'ARRAY' ) {
            for my $subdivision ( @{ $source->{subdivisions} } ) {
                last if @subdivisions >= 10;
                next unless ref $subdivision eq 'HASH';
                my $code = lc( _bounded_text( $subdivision->{code}, 1 ) );
                my $value = _bounded_text( $subdivision->{value}, 240 );
                push @subdivisions, { code => $code, value => $value }
                  if $code =~ /^[xyzv]$/ && $value ne '';
            }
        }
        my $basis = ref $source eq 'HASH'
          ? _bounded_text(
            $source->{basis} // $source->{rationale} // $source->{explanation}
              // 'Heading inferred from the supplied catalogue evidence.',
            1200 )
          : 'Heading inferred from the supplied catalogue evidence.';
        push @candidates,
          {
            heading          => $heading,
            subdivisions     => \@subdivisions,
            confidence       => _confidence_label( ref $source eq 'HASH' ? $source->{confidence} : '' ),
            basis            => $basis,
            evidence         => _string_list( ref $source eq 'HASH' ? $source->{evidence} : [], 12, 400 ),
            authority_status => 'unverified',
          };
    }
    return \@candidates;
}

sub _review_findings {
    my ( $payload, $result ) = @_;
    return [] unless ref $result->{findings} eq 'ARRAY';
    my @findings;
    for my $source ( @{ $result->{findings} } ) {
        last if @findings >= 20;
        next unless ref $source eq 'HASH';
        my $finding = _bounded_text(
            $source->{finding} // $source->{code} // $source->{message}, 120 );
        my $explanation = _bounded_text(
            $source->{explanation} // $source->{rationale} // $source->{message},
            1200 );
        next if $finding eq '' || $explanation eq '';
        my $tag = _bounded_text(
            $source->{tag} // $payload->{tag_context}{tag}, 3 );
        my $subfield = _bounded_text(
            $source->{subfield} // $payload->{tag_context}{active_subfield}, 1 );
        next unless $tag =~ /^\d{3}$/ && $subfield =~ /^[a-z0-9]$/i;
        push @findings,
          {
            finding          => $finding,
            tag              => $tag,
            subfield         => lc($subfield),
            explanation      => $explanation,
            confidence       => _confidence_label( $source->{confidence} ),
            evidence         => _string_list( $source->{evidence}, 12, 400 ),
            authority_status => ( ( $source->{authority_status} || '' ) eq 'not_applicable' )
              ? 'not_applicable'
              : 'unverified',
          };
    }
    return \@findings;
}

# Provider JSON is untrusted even when a model claims structured-output support.
# Canonicalize safe, display-only fields before schema validation so legacy
# provider shapes cannot prevent an otherwise valid LCC candidate from reaching
# the server-side LCCS evidence verifier.
sub _canonicalize_ai_provider_response {
    my ( $self, $payload, $result ) = @_;
    return undef unless ref $result eq 'HASH';
    my $task = $payload->{task} || '';
    my $status = lc( _bounded_text( $result->{status}, 40 ) );
    $status = 'insufficient_evidence'
      unless $status =~ /^(?:ok|insufficient_evidence|incomplete)$/;
    my $canonical = {
        schema_version        => $SCHEMA_VERSION,
        task                  => $task,
        status                => $status,
        warnings              => _string_list( $result->{warnings}, 12, 400 ),
        requires_human_review => JSON::true,
    };

    if ( $task eq 'cataloging_classification' ) {
        my $candidate = _classification_candidate($result);
        $canonical->{candidate} = $candidate if $candidate;
        $canonical->{status} = $candidate ? 'ok' : 'insufficient_evidence'
          unless $status eq 'incomplete';
        $canonical->{authority_status} = $candidate ? 'unverified' : 'not_applicable';
        $canonical->{evidence} = _string_list(
            ref $result->{evidence} eq 'ARRAY' ? $result->{evidence}
              : ref $result->{candidate} eq 'HASH' ? $result->{candidate}{evidence}
              : [],
            12, 400 );
    }
    elsif ( $task eq 'subject_heading_suggestion' ) {
        $canonical->{candidates} = _subject_candidates($result);
        $canonical->{status} = @{ $canonical->{candidates} } ? 'ok' : 'insufficient_evidence'
          unless $status eq 'incomplete';
    }
    elsif ( $task eq 'cataloging_review' ) {
        my $candidate = _classification_candidate($result);
        if ($candidate) {
            $candidate->{evidence} = _string_list(
                ref $result->{classification_candidate} eq 'HASH'
                  ? $result->{classification_candidate}{evidence}
                  : $result->{evidence}, 12, 400 );
            $candidate->{authority_status} = 'unverified';
            $canonical->{classification_candidate} = $candidate;
        }
        $canonical->{subject_candidates} = _subject_candidates($result);
        $canonical->{findings} = _review_findings( $payload, $result );
        my $has_content = $candidate
          || @{ $canonical->{subject_candidates} }
          || @{ $canonical->{findings} };
        $canonical->{status} = $has_content ? 'ok' : 'insufficient_evidence'
          unless $status eq 'incomplete';
    }
    elsif ( $task eq 'punctuation_explanation' ) {
        $canonical->{explanation} = _bounded_text(
            $result->{explanation} // $result->{assistant_message} // $result->{message},
            2000 );
        $canonical->{rule_reference} = _bounded_text(
            $result->{rule_reference} // $result->{rule} // $result->{basis}, 240 );
        $canonical->{evidence} = _string_list( $result->{evidence}, 12, 400 );
        $canonical->{status} = 'insufficient_evidence'
          if $canonical->{explanation} eq '' || $canonical->{rule_reference} eq '';
    }
    elsif ( $task eq 'training_tutor' ) {
        $canonical->{explanation} = _bounded_text(
            $result->{explanation} // $result->{assistant_message} // $result->{message},
            2000 );
        $canonical->{questions} = _string_list(
            ref $result->{questions} eq 'ARRAY' ? $result->{questions}
              : defined $result->{question} ? [ $result->{question} ] : [],
            8, 400 );
        $canonical->{status} = 'insufficient_evidence'
          if $canonical->{explanation} eq '';
    }
    return $canonical;
}

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
        type       => 'LCCS',
        status     => $status,
        source     => $verification->{source} || 'lccs-2024',
        candidate  => $verification->{candidate} || '',
        matches    => \@public_matches,
        validation => $verification->{validation} || {},
    };
    $result->{verification_status} = $status;

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

sub _apply_lcsh_evidence {
    my ( $task, $result, $verification ) = @_;
    return unless $verification && ref $verification eq 'HASH';
    my $candidates = $task eq 'subject_heading_suggestion'
      ? $result->{candidates}
      : $task eq 'cataloging_review'
      ? $result->{subject_candidates}
      : undef;
    return unless ref $candidates eq 'ARRAY';
    my $results = ref $verification->{results} eq 'ARRAY'
      ? $verification->{results}
      : [];
    $result->{authority_lookup_status} = $verification->{status} || 'not_applicable';
    for my $index ( 0 .. $#{$candidates} ) {
        my $candidate = $candidates->[$index];
        next unless $candidate && ref $candidate eq 'HASH';
        my $authority = $results->[$index];
        next unless $authority && ref $authority eq 'HASH';
        my %public = map { exists $authority->{$_} ? ( $_ => $authority->{$_} ) : () }
          qw(scheme status match_type checked authorized submitted_heading heading
          authorized_heading uri variants broader narrower related scope_notes source
          checked_at raw_source_version adapter_version construction_status matches
          error_type http_status cache_status);
        $candidate->{authority} = \%public;
        $candidate->{authority_status} =
          ( $authority->{status} || '' ) eq 'verified' ? 'verified' : 'unverified';
    }
    if ( ( $verification->{status} || '' ) eq 'service_unavailable' ) {
        my $warning =
          'AI subject suggestions are available, but Library of Congress authority verification is temporarily unavailable.';
        push @{ $result->{warnings} }, $warning
          unless grep { $_ eq $warning } @{ $result->{warnings} || [] };
    }
    elsif ( ( $verification->{status} || '' ) eq 'invalid_authority_response' ) {
        my $warning =
          'The Library of Congress authority service returned an invalid response; subject suggestions remain unverified.';
        push @{ $result->{warnings} }, $warning
          unless grep { $_ eq $warning } @{ $result->{warnings} || [] };
    }
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
    _apply_lcsh_evidence(
        $task, $result,
        $provider_meta->{lcsh_evidence}
    );

    # A model cannot promote its own claim. Only the server-side LCCS adapter
    # can verify that a returned classification exists in the 2024 schedule.
    if ( $task eq 'cataloging_classification' ) {
        $result->{authority_status} = 'unverified'
          unless ( $result->{authority_status} || '' ) eq 'verified';
        $result->{candidate}{confidence} = 'insufficient_evidence'
          if ref $result->{candidate} eq 'HASH'
          && $result->{status} eq 'insufficient_evidence';
    }
    if ( $task eq 'subject_heading_suggestion' ) {
        for my $candidate ( @{ $result->{candidates} || [] } ) {
            if ( ref $candidate eq 'HASH' ) {
                $candidate->{authority_status} = 'unverified';
                $candidate->{confidence} = _confidence_label( $candidate->{confidence} );
            }
        }
    }
    if ( $task eq 'cataloging_review' ) {
        $result->{classification_candidate}{authority_status} = 'unverified'
          if ref $result->{classification_candidate} eq 'HASH'
          && ( $result->{classification_candidate}{authority_status} || '' ) ne 'verified';
        if ( ref $result->{classification_candidate} eq 'HASH' ) {
            $result->{classification_candidate}{confidence} =
              _confidence_label( $result->{classification_candidate}{confidence} );
        }
        for my $candidate ( @{ $result->{subject_candidates} || [] } ) {
            if ( ref $candidate eq 'HASH' ) {
                $candidate->{authority_status} = 'unverified';
                $candidate->{confidence} = _confidence_label( $candidate->{confidence} );
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
