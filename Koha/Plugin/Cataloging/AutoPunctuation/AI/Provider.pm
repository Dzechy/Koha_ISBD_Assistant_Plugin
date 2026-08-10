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

package Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider;

use Modern::Perl;
use LWP::UserAgent;
use HTTP::Request;
use JSON qw(to_json from_json);
use Try::Tiny;
use Time::HiRes  qw(usleep time);
use Scalar::Util qw(looks_like_number);

my %MODEL_CAPABILITIES = (
    openai => {
        'gpt-4o'       => { structured_output => 1, reasoning => 0, temperature => 1, tools => 1 },
        'gpt-5'        => { structured_output => 1, reasoning => 1, temperature => 0, tools => 1 },
        'gpt-5.2'      => { structured_output => 1, reasoning => 1, temperature => 0, tools => 1 },
        'gpt-5.4'      => { structured_output => 1, reasoning => 1, temperature => 0, tools => 1 },
        'gpt-5.5'      => { structured_output => 1, reasoning => 1, temperature => 0, tools => 1 },
        'gpt-5.6-terra' => { structured_output => 1, reasoning => 1, temperature => 0, tools => 1 },
    },
    openrouter => {},
);

sub _model_capabilities {
    my ( $self, $settings, $provider, $model ) = @_;
    $provider = lc( $provider || '' );
    $model    = lc( $model || '' );
    my $capabilities = $MODEL_CAPABILITIES{$provider}{$model} || {};
    my %resolved = (
        supports_structured_output => $capabilities->{structured_output} ? 1 : 0,
        supports_reasoning         => $capabilities->{reasoning} ? 1 : 0,
        supports_temperature       => $capabilities->{temperature} ? 1 : 0,
        supports_tools             => $capabilities->{tools} ? 1 : 0,
    );
    my $registry;
    if ( $self && $self->can('get_plugin_dir') ) {
        my $path = $self->get_plugin_dir() . '/rules/ai_model_capabilities.json';
        if ( -e $path && open my $fh, '<:encoding(UTF-8)', $path ) {
            local $/;
            my $content = <$fh>;
            close $fh;
            try { $registry = from_json($content); }
            catch { $registry = undef; };
        }
    }
    my $registered = ref $registry eq 'HASH'
      && ref $registry->{providers} eq 'HASH'
      && ref $registry->{providers}{$provider} eq 'HASH'
      ? $registry->{providers}{$provider}{$model}
      : undef;
    if ( ref $registered eq 'HASH' ) {
        for my $key ( keys %resolved ) {
            $resolved{$key} = $registered->{$key} ? 1 : 0
              if exists $registered->{$key};
        }
    }
    if ( $settings->{ai_model_capabilities} ) {
        my $configured;
        try { $configured = from_json( $settings->{ai_model_capabilities} ); }
        catch { $configured = undef; };
        my $entry = ref $configured eq 'HASH' ? $configured->{$model} : undef;
        if ( ref $entry eq 'HASH' ) {
            for my $key ( keys %resolved ) {
                $resolved{$key} = $entry->{$key} ? 1 : 0 if exists $entry->{$key};
            }
        }
    }
    return \%resolved;
}

sub _parse_structured_content {
    my ( $content ) = @_;
    return undef unless defined $content && $content =~ /\S/;
    my $text = $content;
    $text =~ s/^\s+|\s+$//g;
    $text = $1 if $text =~ /^```(?:json)?\s*(\{.*\})\s*```$/s;
    my $parsed;
    my $has_strict_decoder = eval { require Cpanel::JSON::XS; 1 };
    if ($has_strict_decoder) {
        try {
            $parsed = Cpanel::JSON::XS->new->utf8(0)->allow_dupkeys(0)
              ->decode($text);
        }
        catch { $parsed = undef; };
    }
    else {
        # JSON.pm is retained as a portability fallback. Koha deployments
        # normally provide Cpanel::JSON::XS, which also rejects duplicate keys.
        try { $parsed = from_json($text); }
        catch { $parsed = undef; };
    }
    return ref $parsed eq 'HASH' ? $parsed : undef;
}

sub _structured_output_parameter {
    my ( $provider, $schema, $name ) = @_;
    return {} unless ref $schema eq 'HASH' && %{$schema};
    $name ||= 'cataloging_response';
    return {
        text => {
            format => {
                type => 'json_schema', name => $name,
                strict => JSON::true, schema => $schema,
            }
        }
      }
      if lc( $provider || '' ) eq 'openai';
    return {
        response_format => {
            type => 'json_schema',
            json_schema => {
                name => $name, strict => JSON::true, schema => $schema,
            }
        }
    };
}

sub _extract_text_from_message_content {
    my ( $self, $content ) = @_;
    return '' unless defined $content;
    return $content if !ref $content;
    return '' unless ref $content eq 'ARRAY';
    my $text = '';
    for my $chunk ( @{$content} ) {
        next unless defined $chunk;
        if ( !ref $chunk ) {
            $text .= $chunk;
            next;
        }
        next unless ref $chunk eq 'HASH';
        if ( defined $chunk->{text} && $chunk->{text} ne '' ) {
            $text .= $chunk->{text};
            next;
        }
        if ( defined $chunk->{output_text} && $chunk->{output_text} ne '' ) {
            $text .= $chunk->{output_text};
            next;
        }
        if ( defined $chunk->{content} && !ref $chunk->{content} ) {
            $text .= $chunk->{content};
            next;
        }
    }
    return $text;
}

sub _resolved_ai_max_output_tokens {
    my ( $self, $settings ) = @_;
    return $self->_resolve_ai_max_output_tokens(
        $settings->{ai_max_output_tokens} );
}

sub _call_openai_responses {
    my ( $self, $settings, $prompt, $options ) = @_;
    my $api_key = $self->_decrypt_secret( $settings->{llm_api_key} );
    return { error => 'OpenAI API key not configured.' } unless $api_key;
    my $ua    = LWP::UserAgent->new( timeout => $settings->{ai_timeout} || 60 );
    my $model = _selected_model( $self, $settings );
    return { error => 'OpenAI model not configured.' } unless $model;
    my $system_prompt =
        $options && $options->{system_prompt}
      ? $options->{system_prompt}
      : 'You are an advisory MARC21 cataloguing assistant. Return only valid JSON.';
    my $max_output_tokens = _resolved_ai_max_output_tokens( $self, $settings );
    my $payload           = {
        model => $model,
        input => [
            {
                role    => "system",
                content => [ { type => "input_text", text => $system_prompt } ]
            },
            {
                role    => "user",
                content => [ { type => "input_text", text => $prompt } ]
            }
        ],
        max_output_tokens => $max_output_tokens,
    };
    my $capabilities = _model_capabilities( $self, $settings, 'openai', $model );
    $payload->{temperature} = $settings->{ai_temperature} + 0
      if $capabilities->{supports_temperature};
    if ( $options->{schema} && $capabilities->{supports_structured_output} ) {
        my $format = _structured_output_parameter(
            'openai', $options->{schema}, $options->{schema_name} );
        $payload->{$_} = $format->{$_} for keys %{$format};
    }
    my $effort = _normalized_reasoning_effort( $self, $settings );

    if ( $effort ne 'none' && $capabilities->{supports_reasoning} ) {
        $payload->{reasoning} = { effort => $effort };
    }
    warn "ISBD AI request length: " . length($prompt)
      if $settings->{debug_mode};
    my $request = HTTP::Request->new(
        'POST',
        'https://api.openai.com/v1/responses',
        [
            'Authorization' => "Bearer $api_key",
            'Content-Type'  => 'application/json',
        ],
        to_json($payload)
    );

    my $started  = time;
    my $retry_count = defined $settings->{ai_retry_count}
      ? int( $settings->{ai_retry_count} ) : 1;
    my $attempts = $retry_count + 1;
    my $backoff  = 200_000;
    for my $attempt ( 1 .. $attempts ) {
        my $response = $ua->request($request);
        if ( $response->is_success ) {
            my $result;
            my $raw_body = $response->content || '';
            try {
                $result = from_json($raw_body);
            }
            catch {
                return {
                    error        => 'OpenAI API response was not valid JSON.',
                    raw_response => $raw_body
                };
            };
            my $content   = _extract_response_text( $self, $result );
            my $truncated = _response_truncated( $self, $result );
            warn "ISBD AI response length: " . length($content)
              if $settings->{debug_mode};
            return { error =>
'OpenAI response was empty. Retry once. If this persists, reduce reasoning effort or max output tokens for this model.'
              }
              unless $content;
            my $data = _parse_structured_content($content);
            return {
                raw_text     => $content,
                ( $data ? ( data => $data ) : ( parse_error => 'Provider output was not a single valid JSON object.' ) ),
                raw_response => $raw_body,
                truncated    => $truncated,
                capabilities => $capabilities,
                latency_ms   => int( ( time - $started ) * 1000 ),
                input_tokens => $result->{usage}{input_tokens},
                output_tokens => $result->{usage}{output_tokens},
            };
        }
        my $retryable = $response->code == 408
          || $response->code == 429
          || $response->code >= 500;
        if ( $attempt < $attempts && $retryable ) {
            usleep($backoff);
            $backoff *= 2;
            next;
        }
        if ( $attempt == $attempts || !$retryable ) {
            return {
                error => _format_provider_error( $self, 'OpenAI', $response ) };
        }
    }
    return { error => 'OpenAI API error: unexpected failure' };
}

sub _call_openrouter_responses {
    my ( $self, $settings, $prompt, $options ) = @_;
    my $api_key = $self->_decrypt_secret( $settings->{openrouter_api_key} );
    return { error => 'OpenRouter API key not configured.' } unless $api_key;
    my $ua    = LWP::UserAgent->new( timeout => $settings->{ai_timeout} || 60 );
    my $model = _selected_model( $self, $settings );
    return { error => 'OpenRouter model not configured.' } unless $model;
    my $system_prompt =
        $options && $options->{system_prompt}
      ? $options->{system_prompt}
      : 'You are an advisory MARC21 cataloguing assistant. Return only valid JSON.';
    my $max_output_tokens = _resolved_ai_max_output_tokens( $self, $settings );
    my $payload           = {
        input => [
            {
                type    => "message",
                role    => "system",
                content => $system_prompt
            },
            {
                type    => "message",
                role    => "user",
                content => $prompt
            }
        ],
        max_output_tokens => $max_output_tokens,
        temperature       => $settings->{ai_temperature} + 0
    };

    if ( $model && $model ne 'default' ) {
        $payload->{model} = $model;
    }
    warn "ISBD OpenRouter request length: " . length($prompt)
      if $settings->{debug_mode};
    my $request = HTTP::Request->new(
        'POST',
        'https://openrouter.ai/api/v1/responses',
        [
            'Authorization' => "Bearer $api_key",
            'Content-Type'  => 'application/json',
            'HTTP-Referer'  =>
              $Koha::Plugin::Cataloging::AutoPunctuation::PLUGIN_REPO_URL,
            'X-Title' => 'Koha_ISBD_Cataloging_Assistant',
        ],
        to_json($payload)
    );

    my $retry_count = defined $settings->{ai_retry_count}
      ? int( $settings->{ai_retry_count} ) : 1;
    my $attempts = $retry_count + 1;
    my $backoff  = 200_000;
    for my $attempt ( 1 .. $attempts ) {
        my $response = $ua->request($request);
        if ( $response->is_success ) {
            my $result;
            my $raw_body = $response->content || '';
            try {
                $result = from_json($raw_body);
            }
            catch {
                return {
                    error => 'OpenRouter API response was not valid JSON.',
                    raw_response => $raw_body
                };
            };
            my $content   = _extract_response_text( $self, $result );
            my $truncated = _response_truncated( $self, $result );
            warn "ISBD OpenRouter response length: " . length($content)
              if $settings->{debug_mode};
            return { error =>
'OpenRouter response was empty. Retry once. If this persists, reduce reasoning effort or max output tokens for this model.'
              }
              unless $content;
            return {
                raw_text     => $content,
                text_mode    => 1,
                raw_response => $raw_body,
                truncated    => $truncated
            };
        }
        my $retryable = $response->code == 408
          || $response->code == 429
          || $response->code >= 500;
        if ( $attempt < $attempts && $retryable ) {
            usleep($backoff);
            $backoff *= 2;
            next;
        }
        if ( $attempt == $attempts || !$retryable ) {
            return { error =>
                  _format_provider_error( $self, 'OpenRouter', $response ) };
        }
    }
    return { error => 'OpenRouter API error: unexpected failure' };
}

sub _call_openrouter_chat {
    my ( $self, $settings, $prompt, $options ) = @_;
    my $api_key = $self->_decrypt_secret( $settings->{openrouter_api_key} );
    return { error => 'OpenRouter API key not configured.' } unless $api_key;
    my $ua    = LWP::UserAgent->new( timeout => $settings->{ai_timeout} || 60 );
    my $model = _selected_model( $self, $settings );
    return { error => 'OpenRouter model not configured.' } unless $model;
    my $system_prompt =
        $options && $options->{system_prompt}
      ? $options->{system_prompt}
      : 'You are an advisory MARC21 cataloguing assistant. Return only valid JSON.';
    my $max_output_tokens = _resolved_ai_max_output_tokens( $self, $settings );
    my $payload           = {
        messages => [
            {
                role    => "system",
                content => $system_prompt
            },
            {
                role    => "user",
                content => $prompt
            }
        ],
        max_tokens => $max_output_tokens,
    };
    my $capabilities = _model_capabilities( $self, $settings, 'openrouter', $model );
    $payload->{temperature} = $settings->{ai_temperature} + 0
      if $capabilities->{supports_temperature};
    if ( $options->{schema} && $capabilities->{supports_structured_output} ) {
        my $format = _structured_output_parameter(
            'openrouter', $options->{schema}, $options->{schema_name} );
        $payload->{$_} = $format->{$_} for keys %{$format};
    }

    if ( $model && $model ne 'default' ) {
        $payload->{model} = $model;
    }
    warn "ISBD OpenRouter request length: " . length($prompt)
      if $settings->{debug_mode};
    my $request = HTTP::Request->new(
        'POST',
        'https://openrouter.ai/api/v1/chat/completions',
        [
            'Authorization' => "Bearer $api_key",
            'Content-Type'  => 'application/json',
            'HTTP-Referer'  =>
              $Koha::Plugin::Cataloging::AutoPunctuation::PLUGIN_REPO_URL,
            'X-Title' => 'Koha_ISBD_Cataloging_Assistant',
        ],
        to_json($payload)
    );

    my $started  = time;
    my $retry_count = defined $settings->{ai_retry_count}
      ? int( $settings->{ai_retry_count} ) : 1;
    my $attempts = $retry_count + 1;
    my $backoff  = 200_000;
    for my $attempt ( 1 .. $attempts ) {
        my $response = $ua->request($request);
        if ( $response->is_success ) {
            my $result;
            my $raw_body = $response->content || '';
            try {
                $result = from_json($raw_body);
            }
            catch {
                return {
                    error => 'OpenRouter API response was not valid JSON.',
                    raw_response => $raw_body
                };
            };
            my $content   = _extract_openrouter_text( $self, $result );
            my $truncated = _response_truncated( $self, $result );
            warn "ISBD OpenRouter response length: " . length($content)
              if $settings->{debug_mode};
            return { error =>
'OpenRouter response was empty. Retry once. If this persists, reduce reasoning effort or max output tokens for this model.'
              }
              unless $content;
            my $data = _parse_structured_content($content);
            return {
                raw_text     => $content,
                ( $data ? ( data => $data ) : ( parse_error => 'Provider output was not a single valid JSON object.' ) ),
                raw_response => $raw_body,
                truncated    => $truncated,
                capabilities => $capabilities,
                latency_ms   => int( ( time - $started ) * 1000 ),
                input_tokens => $result->{usage}{prompt_tokens},
                output_tokens => $result->{usage}{completion_tokens},
            };
        }
        my $retryable = $response->code == 408
          || $response->code == 429
          || $response->code >= 500;
        if ( $attempt < $attempts && $retryable ) {
            usleep($backoff);
            $backoff *= 2;
            next;
        }
        if ( $attempt == $attempts || !$retryable ) {
            return { error =>
                  _format_provider_error( $self, 'OpenRouter', $response ) };
        }
    }
    return { error => 'OpenRouter API error: unexpected failure' };
}

sub _extract_openrouter_text {
    my ( $self, $response ) = @_;
    return _extract_response_text( $self, $response );
}

sub _format_provider_error {
    my ( $self, $provider, $response ) = @_;
    my $status = $response ? $response->status_line     : '';
    my $body   = $response ? $response->decoded_content : '';
    my $detail = '';
    if ($body) {
        my $parsed;
        try {
            $parsed = from_json($body);
        }
        catch {
            $parsed = undef;
        };
        if ( $parsed && ref $parsed eq 'HASH' ) {
            if ( lc( $provider || '' ) eq 'openai' ) {
                $detail =
                  $parsed->{error}{message} || $parsed->{error}{code} || '';
            }
            else {
                $detail =
                     $parsed->{error}{message}
                  || $parsed->{data}{error}{message}
                  || $parsed->{error}{code}
                  || '';
            }
        }
        if ( !$detail ) {
            $detail = $body;
            $detail =~ s/\s+/ /g;
            $detail = substr( $detail, 0, 200 );
        }
    }
    my $status_code = $response ? ( $response->code || 0 ) : 0;
    my $label       = $provider || 'Provider';
    my $message =
      $status ? "${label} API error: $status" : "${label} API error";
    $message .= " - $detail" if $detail;
    if ( $status_code == 429 ) {
        $message .=
' Rate limit reached. Wait 30-60 seconds, reduce request frequency/retries, or use a model/account with more quota.';
    }
    return $message;
}

sub _sanitize_ai_response_for_chat {
    my ( $self, $result ) = @_;
    return $result unless $result && ref $result eq 'HASH';
    my $findings = $result->{findings};
    $findings = [] unless $findings && ref $findings eq 'ARRAY';
    for my $finding ( @{$findings} ) {
        next unless $finding && ref $finding eq 'HASH';
        $finding->{proposed_fixes} = [];
    }
    $result->{findings} = $findings;
    my $assistant_message = $result->{assistant_message} // '';
    $assistant_message =~ s/^\s+|\s+$//g if defined $assistant_message;
    if ( !$assistant_message ) {
        $assistant_message = $self->_summarize_ai_findings($findings);
    }
    $assistant_message ||= 'No AI suggestions returned.';
    $result->{assistant_message} = $assistant_message;
    my $confidence = $result->{confidence_percent};
    if ( !defined $confidence || !looks_like_number($confidence) ) {
        $confidence = $self->_confidence_percent_from_findings($findings);
    }
    $confidence                   = 0   if $confidence < 0;
    $confidence                   = 100 if $confidence > 100;
    $result->{confidence_percent} = 0 + $confidence;
    return $result;
}

sub _ai_key_available {
    my ( $self, $settings ) = @_;
    my $provider = lc( $settings->{llm_api_provider} || 'openrouter' );
    if ( $provider eq 'openrouter' ) {
        return $self->_decrypt_secret( $settings->{openrouter_api_key} )
          ? 1
          : 0;
    }
    return $self->_decrypt_secret( $settings->{llm_api_key} ) ? 1 : 0;
}

sub _selected_model {
    my ( $self, $settings ) = @_;
    my $provider = lc( $settings->{llm_api_provider} || 'openrouter' );
    if ( $provider eq 'openrouter' ) {
        my $model = $settings->{ai_model};
        $model = $settings->{ai_model_openrouter}
          if !defined $model || $model eq '';
        $model = '' if defined $model && $model eq 'default';
        return $model;
    }
    my $model = $settings->{ai_model};
    $model = $settings->{ai_model_openai}
      if !defined $model || $model eq '' || $model eq 'default';
    $model = '' if defined $model && $model eq 'default';
    return $model;
}

sub _normalized_reasoning_effort {
    my ( $self, $settings ) = @_;
    my $effort = lc( $settings->{ai_reasoning_effort} || 'low' );
    return $effort if $effort =~ /^(none|low|medium|high)$/;
    return 'low';
}

sub _is_openai_reasoning_model {
    my ( $self, $model ) = @_;
    return 0 unless $model;
    my $id = lc($model);
    return 1 if $id =~ /reasoning/;
    return 1 if $id =~ /^o\d/;
    return 1 if $id =~ /(?:^|-)o\d/;
    return 0;
}

sub _call_ai_provider {
    my ( $self, $settings, $prompt, $options ) = @_;
    my $provider = lc( $settings->{llm_api_provider} || 'openrouter' );
    if ( $provider eq 'openrouter' ) {
        return _call_openrouter_chat( $self, $settings, $prompt, $options );
    }
    return _call_openai_responses( $self, $settings, $prompt, $options );
}

sub generate {
    my ( $self, $settings, $task, $context, $schema, $options ) = @_;
    $options ||= {};
    $options->{task}   = $task;
    $options->{schema} = $schema;
    return _call_ai_provider( $self, $settings, $context, $options );
}

sub _extract_response_text {
    my ( $self, $response ) = @_;
    return '' unless $response && ref $response eq 'HASH';
    if ( $response->{choices} && ref $response->{choices} eq 'ARRAY' ) {
        for my $choice ( @{ $response->{choices} } ) {
            my $message = $choice->{message} || {};
            if ( defined $message->{content} ) {
                my $content = _extract_text_from_message_content( $self,
                    $message->{content} );
                return $content if defined $content && $content ne '';
            }
            my $delta = $choice->{delta} || {};
            if ( defined $delta->{content} ) {
                my $content = _extract_text_from_message_content( $self,
                    $delta->{content} );
                return $content if defined $content && $content ne '';
            }
        }
    }
    if ( $response->{message} && ref $response->{message} eq 'HASH' ) {
        if ( defined $response->{message}{content} ) {
            my $content = _extract_text_from_message_content( $self,
                $response->{message}{content} );
            return $content if defined $content && $content ne '';
        }
    }
    my $content = '';
    if ( $response->{output} && ref $response->{output} eq 'ARRAY' ) {
        for my $item ( @{ $response->{output} } ) {
            next unless $item->{content};
            for my $chunk ( @{ $item->{content} } ) {
                next
                  unless defined $chunk->{text}
                  || defined $chunk->{output_text};
                $content .=
                  defined $chunk->{text}
                  ? $chunk->{text}
                  : $chunk->{output_text};
            }
        }
    }
    $content ||= $response->{output_text} || '';
    return $content;
}

sub _response_truncated {
    my ( $self, $response ) = @_;
    return 0 unless $response && ref $response eq 'HASH';
    if ( $response->{choices} && ref $response->{choices} eq 'ARRAY' ) {
        for my $choice ( @{ $response->{choices} } ) {
            my $reason = $choice->{finish_reason} || '';
            return 1 if lc($reason) eq 'length';
        }
    }
    if ( $response->{output} && ref $response->{output} eq 'ARRAY' ) {
        for my $item ( @{ $response->{output} } ) {
            my $finish = $item->{finish_reason} || '';
            my $status = $item->{status}        || '';
            my $detail = '';
            if ( $item->{incomplete_details}
                && ref $item->{incomplete_details} eq 'HASH' )
            {
                $detail = $item->{incomplete_details}{reason} || '';
            }
            return 1 if lc($finish) eq 'length';
            return 1 if lc($status) eq 'incomplete';
            return 1 if $detail && lc($detail) =~ /max_output_tokens|length/;
        }
    }
    if ( $response->{incomplete_details}
        && ref $response->{incomplete_details} eq 'HASH' )
    {
        my $detail = $response->{incomplete_details}{reason} || '';
        return 1 if $detail && lc($detail) =~ /max_output_tokens|length/;
    }
    return 0;
}

sub _append_truncation_warning {
    my ( $self, $result ) = @_;
    return $result unless $result && ref $result eq 'HASH';
    my $message =
'Output truncated. Increase max output tokens or reduce reasoning effort.';
    my $errors = $result->{errors};
    $errors = [] unless $errors && ref $errors eq 'ARRAY';
    unless (
        grep {
                 $_
              && ref $_ eq 'HASH'
              && $_->{code}
              && $_->{code} eq 'OUTPUT_TRUNCATED'
        } @{$errors}
      )
    {
        push @{$errors}, { code => 'OUTPUT_TRUNCATED', message => $message };
    }
    $result->{errors} = $errors;
    return $result;
}

1;
