# This file is part of Koha.
#
# Copyright (C) 2025  Duke Chijimaka Jonathan
#
# Koha is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# Koha is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Koha; if not, see <http://www.gnu.org/licenses>.

package Koha::Plugin::Cataloging::AutoPunctuation::Api;

use Modern::Perl;
use Try::Tiny;
use Digest::SHA qw(sha256_hex);
use C4::Context;
use CGI;
use JSON ();
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt ();

sub _semantic_subfields {
    my ( $tag, $subfields, $pack ) = @_;
    $subfields = [] unless $subfields && ref $subfields eq 'ARRAY';
    my $model =
         $pack
      && ref $pack eq 'HASH'
      && $pack->{field_relationships}
      && $pack->{field_relationships}{$tag}
      && $pack->{field_relationships}{$tag}{subfields}
      ? $pack->{field_relationships}{$tag}{subfields}
      : {};
    my @indexed = map { { sub => $subfields->[$_], index => $_ } }
      0 .. $#{$subfields};
    return map { $_->{sub} } sort {
        my $a_code = lc( $a->{sub}{code} || '' );
        my $b_code = lc( $b->{sub}{code} || '' );
        my $a_pos  = exists $model->{$a_code}{canonical_position}
          ? $model->{$a_code}{canonical_position}
          : 1_000_000;
        my $b_pos = exists $model->{$b_code}{canonical_position}
          ? $model->{$b_code}{canonical_position}
          : 1_000_000;
        $a_pos <=> $b_pos
          || ( $a_code eq $b_code
            ? $a->{index} <=> $b->{index}
            : $a_code cmp $b_code )
    } @indexed;
}

sub _semantic_primary_subfield {
    my ( $tag, $subfields, $pack ) = @_;
    my ($primary) = grep {
        $_ && $_->{code} && defined $_->{value} && $_->{value} =~ /\S/
    } _semantic_subfields( $tag, $subfields, $pack );
    return $primary ? lc( $primary->{code} || '' ) : '';
}

sub _ai_prompt_cache_component {
    my ( $self, $settings, $mode ) = @_;
    $settings = {} unless $settings && ref $settings eq 'HASH';
    my $prompt_mode =
      ( $mode || '' ) eq 'cataloging' ? 'cataloging' : 'punctuation';
    my $defaults =
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_default_ai_prompt_templates_for_mode(
        $self);
    my $template =
      $prompt_mode eq 'cataloging'
      ? ( $settings->{ai_prompt_cataloging} // '' )
      : ( $settings->{ai_prompt_default} // '' );
    if ( $template !~ /\S/ ) {
        $template =
          $prompt_mode eq 'cataloging'
          ? ( $defaults->{cataloging} || '' )
          : ( $defaults->{default} || '' );
    }
    return sha256_hex(
        join( '|',
            $Koha::Plugin::Cataloging::AutoPunctuation::AI_PROMPT_VERSION,
            $prompt_mode, $template )
    );
}

sub _safe_task_response {
    my ( $payload, $status, $warning ) = @_;
    my $task = $payload->{task} || '';
    my $base = {
        schema_version        => '1.0.0',
        task                  => $task,
        status                => $status || 'insufficient_evidence',
        warnings              => [ grep { defined $_ && $_ ne '' } ($warning) ],
        requires_human_review => JSON::true,
    };
    if ( $task eq 'punctuation_explanation' ) {
        $base->{explanation}    = '';
        $base->{rule_reference} = '';
        $base->{evidence}       = [];
    }
    elsif ( $task eq 'cataloging_classification' ) {
        $base->{authority_status} = 'unverified';
        $base->{evidence}         = [];
    }
    elsif ( $task eq 'subject_heading_suggestion' ) {
        $base->{candidates} = [];
    }
    elsif ( $task eq 'cataloging_review' ) {
        $base->{findings} = [];
    }
    else {
        $base->{explanation} = '';
        $base->{questions}   = [];
    }
    return $base;
}

sub _task_response_for_client {
    my ( $payload, $result, $deterministic_findings ) = @_;
    my $task = $payload->{task} || '';
    $result->{request_id}  = $payload->{request_id};
    $result->{tag_context} = $payload->{tag_context};
    $result->{version}     = $result->{schema_version} || '1.0.0';
    $result->{disclaimer}  = 'AI suggestion; authority verification and cataloguer review required.';
    $result->{findings}    = [] unless ref $result->{findings} eq 'ARRAY';
    $result->{errors}      = [];
    $result->{classification} = '';
    $result->{subjects}       = [];

    my $candidate = $task eq 'cataloging_classification'
      ? $result->{candidate}
      : $result->{classification_candidate};
    if ( ref $candidate eq 'HASH' && $result->{status} eq 'ok' ) {
        $result->{classification} = $candidate->{value} || '';
    }
    my $subjects = $task eq 'subject_heading_suggestion'
      ? $result->{candidates}
      : $result->{subject_candidates};
    if ( ref $subjects eq 'ARRAY' ) {
        for my $subject ( @{$subjects} ) {
            next unless ref $subject eq 'HASH' && $subject->{heading};
            my %subfields = ( a => $subject->{heading}, x => [], y => [], z => [], v => [] );
            for my $subdivision ( @{ $subject->{subdivisions} || [] } ) {
                next unless ref $subdivision eq 'HASH';
                my $code = $subdivision->{code} || '';
                push @{ $subfields{$code} }, $subdivision->{value}
                  if exists $subfields{$code} && $code ne 'a';
            }
            push @{ $result->{subjects} },
              { tag => '650', ind1 => ' ', ind2 => '0', subfields => \%subfields,
                authority_status => 'unverified', confidence => $subject->{confidence} || 'low' };
        }
    }
    if ( $task eq 'punctuation_explanation' ) {
        my $first = ref $deterministic_findings eq 'ARRAY'
          ? $deterministic_findings->[0]
          : undef;
        if ( ref $first eq 'HASH' ) {
            $result->{rule_reference} = $first->{rule_reference}
              || $first->{rule_basis}
              || $first->{rationale}
              || $first->{code}
              || '';
            $result->{evidence} = [ $first->{message} || $first->{code} || '' ];
        }
        $result->{assistant_message} = $result->{explanation} || '';
        $result->{findings} = $deterministic_findings || [];
    }
    elsif ( $task eq 'training_tutor' ) {
        $result->{assistant_message} = $result->{explanation} || '';
    }
    else {
        $result->{assistant_message} = join( "\n", grep { $_ ne '' }
          ( $candidate && ref $candidate eq 'HASH' ? ( $candidate->{basis} || '' ) : '',
            @{ $result->{warnings} || [] } ) );
    }
    return $result;
}

sub _cataloging_insufficient_response {
    my ( $self, $payload, $message ) = @_;
    my $result = _safe_task_response(
        $payload, 'insufficient_evidence',
        $message || 'The record does not contain enough evidence for this task.' );
    $result = $self->_normalize_ai_task_response( $payload, $result, {} );
    return _task_response_for_client( $payload, $result, [] );
}

sub _debug_raw_response_enabled {
    my ( $self, $settings ) = @_;
    return 0 unless $settings && $settings->{ai_debug_include_raw_response};
    my $userenv = C4::Context->userenv;
    return 0 unless $userenv && ref $userenv eq 'HASH';
    my $flags = $userenv->{flags} || 0;
    return ( $flags & 1 ) ? 1 : 0;
}

sub _sanitize_debug_text {
    my ( $self, $text, $max_length ) = @_;
    my $value = defined $text ? "$text" : '';
    $value =~ s/\r\n/\n/g;
    $value =~
s/([\"\']?(?:api[_-]?key|openrouter_api_key|llm_api_key|token|secret)[\"\']?\s*[:=]\s*[\"\']?)([^\"\'\s,}]+)/${1}[REDACTED]/ig;
    $value =~
s/([\"\']?authorization[\"\']?\s*[:=]\s*[\"\']?bearer\s+)([^\"\'\s,}]+)/${1}[REDACTED]/ig;
    $value =~ s/\b(Bearer\s+)([A-Za-z0-9._\-]+)/${1}[REDACTED]/ig;
    my $limit = ( $max_length && $max_length > 0 ) ? int($max_length) : 0;
    if ( $limit && length($value) > $limit ) {
        my $truncated = length($value) - $limit;
        my $suffix    = " [TRUNCATED:$truncated]";
        my $cutoff    = $limit - length($suffix);
        $cutoff = 0 if $cutoff < 0;
        $value  = substr( $value, 0, $cutoff ) . $suffix;
    }
    return $value;
}

sub _strip_internal_payload_fields {
    my ($payload) = @_;
    return {} unless $payload && ref $payload eq 'HASH';
    delete $payload->{csrf_token};
    return $payload;
}

sub _build_ai_debug_payload {
    my ( $self, $settings, $provider_result, $parse_error_override ) = @_;
    $provider_result = {}
      unless $provider_result && ref $provider_result eq 'HASH';
    my %debug;
    if ( $settings->{debug_mode} ) {
        for my $key (qw(request_id provider model task latency_ms input_tokens output_tokens cache_status parse_status schema_status guardrail_status)) {
            $debug{$key} = $provider_result->{$key}
              if defined $provider_result->{$key} && $provider_result->{$key} ne '';
        }
    }
    my $parse_error =
      defined $parse_error_override
      ? $parse_error_override
      : ( $provider_result->{parse_error} || '' );
    $parse_error = _sanitize_debug_text( $self, $parse_error, 200 );
    $debug{parse_error} = $parse_error if $parse_error ne '';

    if ( _debug_raw_response_enabled( $self, $settings ) ) {
        my $raw_provider =
          _sanitize_debug_text( $self, $provider_result->{raw_response},
            12000 );
        my $raw_text =
          _sanitize_debug_text( $self, $provider_result->{raw_text}, 3800 );
        $debug{raw_provider_response} = $raw_provider if $raw_provider ne '';
        $debug{raw_text}              = $raw_text     if $raw_text ne '';
    }
    return \%debug;
}

sub _ai_error_status {
    my ( $self, $response ) = @_;
    return '500 Internal Server Error'
      unless $response && ref $response eq 'HASH';
    return $response->{status} if $response->{status};
    my $error = lc( $response->{error} || '' );
    return '429 Too Many Requests'   if $error =~ /rate limit/;
    return '503 Service Unavailable' if $error =~ /circuit breaker open/;
    return '503 Service Unavailable'
      if $error =~
      /ai features are disabled|missing api key|ai model not configured/;
    return '422 Unprocessable Entity'
      if $error =~
      /invalid request|excluded from ai assistance|no isbd rule defined/;
    return '502 Bad Gateway'
      if $error =~
/response was empty|response was not valid json|invalid ai response format/;
    return '502 Bad Gateway' if $error =~ /api error|provider request failed/;
    return '500 Internal Server Error' if $error =~ /request failed|exception/;
    return '500 Internal Server Error';
}

sub api_classify {
    my ( $self, $args ) = @_;
    return $self->_json_error( '410 Gone',
        'Deprecated endpoint. Use ai_suggest instead.' );
}

sub validate_field {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('POST');
    my ( $response, $status );
    try {
        my $settings = {};
        try {
            $settings = $self->_load_settings();
        }
        catch {
            $settings = $self->_default_settings();
        };
        $settings = {} unless $settings && ref $settings eq 'HASH';
        unless ( $self->_is_authenticated_staff_session() ) {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }
        my $payload = $self->_read_json_payload();
        if ( $payload->{error} ) {
            $response = {
                ok      => 0,
                error   => $payload->{error},
                details => $payload->{details}
            };
            $status = $payload->{status} || '400 Bad Request';
            return;
        }
        unless ( $self->_csrf_ok($payload) ) {
            $response = {
                ok         => 0,
                error      => 'Invalid CSRF token',
                csrf_debug => $self->_csrf_debug_info()
            };
            $status = '403 Forbidden';
            return;
        }
        $payload = _strip_internal_payload_fields($payload);
        my $errors =
          $self->_validate_schema( 'validate_field_request.json', $payload );
        if ( @{$errors} ) {
            $response =
              { ok => 0, error => 'Invalid request', details => $errors };
            $status = '422 Unprocessable Entity';
            return;
        }

        my $pack = $self->_merge_rules_pack($settings);
        $response =
          $self->_validate_field_with_rules( $payload, $pack, $settings );
        $status = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation validate_field error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

sub validate_record {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('POST');
    my ( $response, $status );
    try {
        my $settings = {};
        try {
            $settings = $self->_load_settings();
        }
        catch {
            $settings = $self->_default_settings();
        };
        $settings = {} unless $settings && ref $settings eq 'HASH';
        unless ( $self->_is_authenticated_staff_session() ) {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }
        my $payload = $self->_read_json_payload();
        if ( $payload->{error} ) {
            $response = {
                ok      => 0,
                error   => $payload->{error},
                details => $payload->{details}
            };
            $status = $payload->{status} || '400 Bad Request';
            return;
        }
        unless ( $self->_csrf_ok($payload) ) {
            $response = {
                ok         => 0,
                error      => 'Invalid CSRF token',
                csrf_debug => $self->_csrf_debug_info()
            };
            $status = '403 Forbidden';
            return;
        }
        $payload = _strip_internal_payload_fields($payload);
        my $errors =
          $self->_validate_schema( 'validate_record_request.json', $payload );
        if ( @{$errors} ) {
            $response =
              { ok => 0, error => 'Invalid request', details => $errors };
            $status = '422 Unprocessable Entity';
            return;
        }

        my $pack = $self->_merge_rules_pack($settings);
        $response =
          $self->_validate_record_with_rules( $payload, $pack, $settings );
        $status = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation validate_record error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

sub ai_suggest {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('POST');
    my ( $response, $status );
    try {
        my $settings = {};
        try {
            $settings = $self->_load_settings();
        }
        catch {
            $settings = $self->_default_settings();
        };
        $settings = {} unless $settings && ref $settings eq 'HASH';

        unless ( $self->_is_authenticated_staff_session() ) {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }
        my $payload = $self->_read_json_payload();
        if ( $payload->{error} ) {
            $response = {
                ok      => 0,
                error   => $payload->{error},
                details => $payload->{details}
            };
            $status = $payload->{status} || '400 Bad Request';
            return;
        }
        unless ( $self->_csrf_ok($payload) ) {
            $response = {
                ok         => 0,
                error      => 'Invalid CSRF token',
                csrf_debug => $self->_csrf_debug_info()
            };
            $status = '403 Forbidden';
            return;
        }
        $payload = _strip_internal_payload_fields($payload);

        my $response_inner;
        eval {
          AI_REQUEST: {
            my $payload_copy =
              $self->_normalize_ai_request_payload( $payload, $settings );
            $payload = $payload_copy if $payload_copy;
            my $errors = $self->_validate_schema( 'ai_request.json', $payload );
            if ( @{$errors} ) {
                $response_inner =
                  { error => 'Invalid request', details => $errors };
                last AI_REQUEST;
            }

            unless ( $settings->{ai_enable}
                && $self->_ai_key_available($settings) )
            {
                $response_inner =
                  { error =>
'AI features are disabled or missing API key for the selected provider.'
                  };
                last AI_REQUEST;
            }

            my $task = $payload->{task} || '';
            my $cataloging_mode = $task =~ /^(?:cataloging_classification|subject_heading_suggestion|cataloging_review)$/ ? 1 : 0;
            my $tag_context      = $payload->{tag_context}         || {};
            my $tag              = $tag_context->{tag}             || '';
            my $subfields        = $tag_context->{subfields}       || [];
            my $pack             = $self->_merge_rules_pack($settings);
            my $primary_subfield = $tag_context->{active_subfield} || '';
            $primary_subfield = lc( $primary_subfield || '' );
            $primary_subfield =
              _semantic_primary_subfield( $tag, $subfields, $pack )
              unless $primary_subfield;

            if ($cataloging_mode) {
                my $cataloging_tag_context =
                  $self->_cataloging_tag_context_from_payload($payload);
                if ( !$cataloging_tag_context || !%{$cataloging_tag_context} ) {
                    $response_inner = _cataloging_insufficient_response(
                        $self, $payload,
                        '245$a is required for cataloging guidance.' );
                    last AI_REQUEST;
                }
                my $source_result = $self->_cataloging_source_from_tag_context(
                    $cataloging_tag_context);
                if ( $source_result->{error} ) {
                    $response_inner = _cataloging_insufficient_response(
                        $self, $payload, $source_result->{error} );
                    last AI_REQUEST;
                }
                if ( $self->_is_excluded_field( $settings, '245', 'a' ) ) {
                    $response_inner =
                      { error =>
'AI cataloging guidance is disabled because 245$a is excluded.'
                      };
                    last AI_REQUEST;
                }
            }
            else {
                if (
                    $self->_is_excluded_field(
                        $settings, $tag, $primary_subfield
                    )
                  )
                {
                    $response_inner =
                      { error => 'Field is excluded from AI assistance.' };
                    last AI_REQUEST;
                }
                my $covered =
                  $self->_is_field_covered( $pack, $tag, $primary_subfield,
                    $tag_context->{ind1}, $tag_context->{ind2} );
                unless ($covered) {
                    $response_inner =
                      { error =>
'No ISBD rule defined for this field; AI assistance disabled.'
                      };
                    last AI_REQUEST;
                }
            }

            my $user_key = $self->_current_user_key();
            my $provider = lc( $settings->{llm_api_provider} || 'openrouter' );
            unless ( $self->_rate_limit_ok( $settings, $user_key, $provider ) )
            {
                $response_inner =
                  { error => 'Rate limit exceeded. Please try again later.' };
                last AI_REQUEST;
            }

            my $model_key = $self->_selected_model($settings);
            unless ($model_key) {
                $response_inner =
                  { error =>
'AI model not configured. Select a model in plugin settings.'
                  };
                last AI_REQUEST;
            }
            my $circuit_key = $self->_circuit_key( $provider, $model_key );
            my $capability_key = $self->_canonical_json(
                $self->_model_capabilities( $settings, $provider, $model_key ) );
            unless ( $self->_circuit_breaker_ok( $settings, $circuit_key ) ) {
                $response_inner =
                  { error => 'AI circuit breaker open. Please retry later.' };
                last AI_REQUEST;
            }

            my $cataloging_source = '';
            my $deterministic_findings = [];
            if ($cataloging_mode) {
                my $cataloging_tag_context =
                  $self->_cataloging_tag_context_from_payload($payload);
                my $source_result = $self->_cataloging_source_from_tag_context(
                    $cataloging_tag_context);
                if ( $source_result->{error} ) {
                    $response_inner = _cataloging_insufficient_response(
                        $self, $payload, $source_result->{error} );
                    last AI_REQUEST;
                }
                $cataloging_source = $source_result->{source};
                my $filtered_tag_context =
                  $self->_redact_tag_context( $cataloging_tag_context,
                    $settings );
                $payload->{tag_context} = $filtered_tag_context;
                my $context_settings = { %{$settings} };
                $context_settings->{ai_context_mode} = $payload->{context_mode}
                  if $payload->{context_mode};
                my $filtered_record = $self->_filter_record_context(
                    $payload->{record_context}, $context_settings,
                    $cataloging_tag_context );
                if ( $filtered_record && @{ $filtered_record->{fields} || [] } ) {
                    $payload->{record_context} = $filtered_record;
                }
                else {
                    delete $payload->{record_context};
                }
            }
            else {
                my $field_payload = {
                    tag       => $tag,
                    ind1      => $tag_context->{ind1} || '',
                    ind2      => $tag_context->{ind2} || '',
                    subfields => $subfields,
                };
                my $deterministic = $self->_validate_field_with_rules(
                    $field_payload, $pack, $settings );
                $deterministic_findings = $deterministic->{findings} || [];
                if ( $task eq 'punctuation_explanation'
                    && !@{$deterministic_findings} )
                {
                    my $no_finding = _safe_task_response(
                        $payload, 'insufficient_evidence',
                        'No deterministic punctuation finding is available to explain.' );
                    $no_finding = $self->_normalize_ai_task_response(
                        $payload, $no_finding,
                        { provider => $provider, model => $model_key } );
                    $response_inner = _task_response_for_client(
                        $payload, $no_finding, [] );
                    last AI_REQUEST;
                }
                my $filtered_record =
                  $self->_filter_record_context( $payload->{record_context},
                    $settings, $tag_context );
                if (   $filtered_record
                    && $filtered_record->{fields}
                    && @{ $filtered_record->{fields} } )
                {
                    $payload->{record_context} = $filtered_record;
                }
                else {
                    delete $payload->{record_context};
                }
            }
            my $prompt = $self->_build_ai_prompt(
                $payload,
                $settings,
                {
                    source      => $cataloging_source,
                    tag_context => $payload->{tag_context},
                    deterministic_findings => $deterministic_findings,
                }
            );
            my $prompt_hash = _ai_prompt_cache_component( $self, $settings,
                $cataloging_mode ? 'cataloging' : 'punctuation' );
            $tag_context      = $payload->{tag_context}         || {};
            $tag              = $tag_context->{tag}             || '';
            $subfields        = $tag_context->{subfields}       || [];
            $primary_subfield = $tag_context->{active_subfield} || '';
            $primary_subfield = lc( $primary_subfield || '' );
            $primary_subfield =
              _semantic_primary_subfield( $tag, $subfields, $pack )
              unless $primary_subfield;
            my $rules_version = $pack->{version} || '';
            my $field_text = join( '|',
                map { ( $_->{code} || '' ) . '=' . ( $_->{value} // '' ) }
                  @{$subfields} );
            my $feature_key =
              $self->_canonical_json( $payload->{features} || {} );
            my $record_context_key = '';

            if ( $payload->{record_context}
                && ref $payload->{record_context} eq 'HASH' )
            {
                my $normalized_context =
                  $self->_normalize_record_context_for_cache(
                    $payload->{record_context} );
                $record_context_key =
                  $self->_canonical_json($normalized_context);
            }
            my $cache_key = sha256_hex(
                join( '|',
                    $task,
                    'schema:1.0.0',
                    $tag,
                    ( $tag_context->{ind1} // '' ),
                    ( $tag_context->{ind2} // '' ),
                    $self->_normalize_occurrence( $tag_context->{occurrence} ),
                    $primary_subfield,
                    $field_text,
                    $rules_version,
                    $provider,
                    ( $model_key || '' ),
                    $Koha::Plugin::Cataloging::AutoPunctuation::AI_PROMPT_VERSION,
                    $prompt_hash,
                    $user_key,
                    $feature_key,
                    ( $payload->{context_mode} || 'tag_only' ),
                    ( $settings->{ai_prompt_max_length} || '' ),
                    ( $settings->{ai_temperature} // '' ),
                    ( $settings->{ai_reasoning_effort} || '' ),
                    ( $settings->{ai_redaction_rules} || '' ),
                    ( $settings->{ai_redact_856_querystrings} ? 1 : 0 ),
                    ( $settings->{ai_model_capabilities} || '' ),
                    $capability_key,
                    $record_context_key )
            );
            if ( my $cached = $self->_cache_get( $settings, $cache_key ) ) {
                if ( $settings->{debug_mode} && ref $cached eq 'HASH' ) {
                    $cached->{debug} ||= {};
                    $cached->{debug}{cache_status} = 'hit';
                    $cached->{debug}{request_id}   = $payload->{request_id};
                    $cached->{debug}{provider}     = $provider;
                    $cached->{debug}{model}        = $model_key;
                    $cached->{debug}{task}         = $task;
                }
                $response_inner = $cached;
                last AI_REQUEST;
            }

            my $schema = $self->_ai_task_schema($task);
            my $provider_options = {
                system_prompt => $self->_ai_system_policy(),
                schema        => $schema,
                schema_name   => 'isbd_' . $task . '_v1',
                task          => $task,
            };
            my $provider_result = $self->_generate_ai(
                $settings, $task, $prompt, $schema, $provider_options );
            $provider_result->{request_id}  = $payload->{request_id};
            $provider_result->{provider}    = $provider;
            $provider_result->{model}       = $model_key;
            $provider_result->{task}        = $task;
            $provider_result->{cache_status} = 'miss';
            $provider_result->{parse_status} = $provider_result->{data} ? 'parsed' : 'invalid';
            if ( $provider_result->{error} ) {
                $self->_record_failure( $settings, $circuit_key );
                $response_inner = { error => $provider_result->{error} };
                last AI_REQUEST;
            }

            my $result = $provider_result->{data};
            my $validation_errors = $result
              ? $self->_validate_ai_task_response( $payload, $result )
              : [ $provider_result->{parse_error} || 'Invalid structured output.' ];

            # One targeted repair is allowed for syntactic/schema failures.
            if ( @{$validation_errors} && !$provider_result->{truncated} ) {
                my $repair_settings = { %{$settings}, ai_retry_count => 0 };
                my $repair_prompt = $prompt
                  . "\nThe previous response failed validation: "
                  . join( '; ', @{$validation_errors} )
                  . "\nReturn a corrected JSON object only. Do not add facts.";
                $provider_result = $self->_generate_ai(
                    $repair_settings, $task, $repair_prompt, $schema,
                    $provider_options );
                $result = $provider_result->{data};
                $validation_errors = $result
                  ? $self->_validate_ai_task_response( $payload, $result )
                  : [ $provider_result->{parse_error} || $provider_result->{error} || 'Repair failed.' ];
            }

            if ( $provider_result->{truncated} ) {
                $result = _safe_task_response( $payload, 'incomplete',
                    'Provider output was truncated; no suggestion was accepted.' );
            }
            elsif ( @{$validation_errors} ) {
                # Safe degraded mode is structured and display-only. Arbitrary
                # prose never becomes a classification, heading, or MARC patch.
                $result = _safe_task_response( $payload,
                    'insufficient_evidence',
                    'The provider response could not be validated; no suggestion was accepted.' );
                $self->_record_failure( $settings, $circuit_key );
            }

            $result = $self->_normalize_ai_task_response(
                $payload, $result,
                {
                    provider  => $provider,
                    model     => $model_key,
                    truncated => $provider_result->{truncated} ? 1 : 0,
                }
            );
            $result = _task_response_for_client(
                $payload, $result, $deterministic_findings );

            $provider_result->{parse_status} = $provider_result->{data}
              ? 'parsed' : 'invalid';
            $provider_result->{schema_status} = @{$validation_errors}
              ? 'invalid' : 'valid';
            $provider_result->{guardrail_status} = 'passed';

            my $debug = _build_ai_debug_payload(
                $self, $settings, $provider_result,
                @{$validation_errors} ? join( '; ', @{$validation_errors} ) : '' );
            $result->{debug} = $debug
              if %{$debug}
              && ( $debug->{parse_error}
                || _debug_raw_response_enabled( $self, $settings ) );

            $self->_record_success( $settings, $circuit_key )
              unless @{$validation_errors};
            $self->_cache_set( $settings, $cache_key, $result );
            $response_inner = $result;
          }
        };
        if ($@) {
            my $message = "$@";
            $message =~ s/\s+$//;
            warn "ISBD AI exception: $message";
            $response_inner = {
                error  => 'AI request failed. Check server logs for details.',
                status => '500 Internal Server Error'
            };
        }
        $response_inner ||= {
            error  => 'AI request failed. Check server logs for details.',
            status => '500 Internal Server Error'
        };
        if ( $response_inner->{error} ) {
            $response_inner->{ok} = 0 unless exists $response_inner->{ok};
            $status = _ai_error_status( $self, $response_inner );
        }
        else {
            $response_inner->{ok} = 1 unless exists $response_inner->{ok};
            $status = '200 OK';
        }
        $response = $response_inner;
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation ai_suggest error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

sub test_connection {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('POST');
    my ( $response, $status );
    try {
        unless ( $self->_is_authenticated_staff_session() ) {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }
        unless ( $self->_csrf_ok() ) {
            $response = {
                ok         => 0,
                error      => 'Invalid CSRF token',
                csrf_debug => $self->_csrf_debug_info()
            };
            $status = '403 Forbidden';
            return;
        }
        my $settings = {};
        try {
            $settings = $self->_load_settings();
        }
        catch {
            $settings = $self->_default_settings();
        };
        $settings = {} unless $settings && ref $settings eq 'HASH';
        unless ( $self->_ai_key_available($settings) ) {
            $response = { ok => 0, error => 'AI not configured.' };
            $status   = '400 Bad Request';
            return;
        }
        my $prompt = "Reply with a short plain-text confirmation.";
        my $result = $self->_call_ai_provider( $settings, $prompt, {} );
        if ( $result->{error} ) {
            $response = { ok => 0, error => $result->{error} };
            $status   = '502 Bad Gateway';
            return;
        }
        $response = { ok => 1, status => 'ok' };
        $status   = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation test_connection error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

sub ai_models {
    my ( $self, $args ) = @_;
    my $request_method = $ENV{REQUEST_METHOD} || '';
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $request_method eq 'GET' || $request_method eq 'POST';

    my ( $response, $status );
    try {
        my $settings = {};
        try {
            $settings = $self->_load_settings();
        }
        catch {
            $settings = $self->_default_settings();
        };
        $settings = {} unless $settings && ref $settings eq 'HASH';
        unless ( $self->_is_authenticated_staff_session() ) {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }

        my $payload = {};
        if ( $request_method eq 'POST' ) {
            $payload = $self->_read_json_payload();
            if ( $payload->{error} ) {
                $response = {
                    ok      => 0,
                    error   => $payload->{error},
                    details => $payload->{details}
                };
                $status = $payload->{status} || '400 Bad Request';
                return;
            }
            unless ( $self->_csrf_ok($payload) ) {
                $response = {
                    ok         => 0,
                    error      => 'Invalid CSRF token',
                    csrf_debug => $self->_csrf_debug_info()
                };
                $status = '403 Forbidden';
                return;
            }
            $payload = _strip_internal_payload_fields($payload);
        }

        my $cgi = $self->{'cgi'} || CGI->new;
        my $provider =
          lc(    ( $payload->{provider} // '' )
              || $cgi->param('provider')
              || $settings->{llm_api_provider}
              || 'openrouter' );
        $provider = $provider eq 'openrouter' ? 'openrouter' : 'openai';
        my $force = 0;
        if ( exists $payload->{force} ) {
            $force = $payload->{force} ? 1 : 0;
        }
        else {
            $force = $cgi->param('force') ? 1 : 0;
        }
        my $allow_public = 0;
        if ( exists $payload->{allow_public} ) {
            $allow_public = $payload->{allow_public} ? 1 : 0;
        }
        else {
            $allow_public = $cgi->param('allow_public') ? 1 : 0;
        }

        my $key_present =
          $provider eq 'openrouter'
          ? (
            $self->_decrypt_secret( $settings->{openrouter_api_key} ) ? 1 : 0 )
          : ( $self->_decrypt_secret( $settings->{llm_api_key} ) ? 1 : 0 );
        my $allow_public_openrouter =
          ( $provider eq 'openrouter' && $allow_public ) ? 1 : 0;

        my $cache = {};
        try {
            $cache = $self->_load_model_cache();
        }
        catch {
            $cache = {};
        };
        $cache = {} unless $cache && ref $cache eq 'HASH';
        my $ttl = 60 * 60;
        unless ( $key_present || $allow_public_openrouter ) {
            my $cached_models =
                ( $cache->{$provider} && ref $cache->{$provider} eq 'HASH' )
              ? ( $cache->{$provider}{models} || [] )
              : [];
            $response = {
                ok          => 1,
                provider    => $provider,
                key_present => 0,
                cached      => ( $cached_models && @{$cached_models} ) ? 1 : 0,
                fetched_at  =>
                  ( $cache->{$provider} && $cache->{$provider}{fetched_at} )
                ? $cache->{$provider}{fetched_at}
                : 0,
                models  => $cached_models,
                warning =>
'API key not configured for the selected provider. Save a key to fetch live models.'
            };
            $status = '200 OK';
            return;
        }
        if (  !$force
            && $cache->{$provider}
            && $cache->{$provider}{fetched_at}
            && ( $cache->{$provider}{fetched_at} + $ttl ) > time )
        {
            $response = {
                ok          => 1,
                provider    => $provider,
                key_present => $key_present,
                cached      => 1,
                fetched_at  => $cache->{$provider}{fetched_at},
                models      => $cache->{$provider}{models} || [],
                warning     => (
                    $key_present
                    ? undef
                    : 'API key not configured. Showing cached model list.'
                )
            };
            $status = '200 OK';
            return;
        }

        my $result = {};
        try {
            if ( $provider eq 'openrouter' ) {
                my $fetch_options =
                  { allow_public => $allow_public_openrouter };
                $result =
                  $self->_fetch_openrouter_models( $settings, $fetch_options );
            }
            else {
                $result = $self->_fetch_openai_models($settings);
            }
        }
        catch {
            my $message = "$_";
            $message =~ s/\s+$//;
            $result = {
                error   => 'Model provider request failed.',
                warning => $message
            };
        };
        $result = {} unless $result && ref $result eq 'HASH';
        if ( $result->{error} ) {
            my $cached_models =
                ( $cache->{$provider} && ref $cache->{$provider} eq 'HASH' )
              ? ( $cache->{$provider}{models} || [] )
              : [];
            if ( $cached_models && @{$cached_models} ) {
                $response = {
                    ok          => 1,
                    provider    => $provider,
                    key_present => $key_present,
                    cached      => 1,
                    fetched_at  => ( $cache->{$provider}{fetched_at} || 0 ),
                    models      => $cached_models,
                    warning     => $result->{warning}
                      || $result->{error}
                      || 'Provider model lookup failed. Showing cached model list.'
                };
                $status = '200 OK';
                return;
            }
            my $error_message =
              $result->{error} || 'Model provider request failed.';
            if ( $result->{warning}
                && index( $error_message, $result->{warning} ) == -1 )
            {
                $error_message .= ' ' . $result->{warning};
            }
            $response = {
                ok          => 0,
                provider    => $provider,
                key_present => $key_present,
                error       => $error_message,
                models      => [],
                warning     => $result->{warning}
            };
            $status = '502 Bad Gateway';
            return;
        }

        my $models     = $result->{models} || [];
        my $fetched_at = time;
        if ( @{$models} || !$result->{warning} ) {
            $cache->{$provider} = {
                fetched_at => $fetched_at,
                models     => $models
            };
            try {
                $self->_save_model_cache($cache);
            }
            catch {
                # Model cache persistence should not fail the API request.
            };
        }
        $response = {
            ok          => 1,
            provider    => $provider,
            key_present => $key_present,
            cached      => 0,
            fetched_at  => $fetched_at,
            models      => $models,
            warning     => $result->{warning}
        };
        $status = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation ai_models error: $message";
        $response = {
            ok    => 0,
            error => 'Model list request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

1;
