# This file is part of Koha.
#
# Copyright (C) 2026 Duke Chijimaka Jonathan
#
# Koha is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.

use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;

BEGIN {
    package C4::Context;
    $INC{'C4/Context.pm'} = 1;
}

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::Api;

{
    package Local::AiEndpointHarness;

    sub new { return bless {}, shift; }
    sub _require_method { return 1; }
    sub _load_settings {
        return {
            ai_enable        => 0,
            llm_api_provider => 'openrouter'
        };
    }
    sub _is_authenticated_staff_session { return 1; }
    sub _read_json_payload {
        return {
            request_id   => 'endpoint-response-regression',
            task         => 'punctuation_explanation',
            context_mode => 'tag_only',
            tag_context  => {
                tag             => '245',
                ind1            => '1',
                ind2            => '0',
                occurrence      => 0,
                active_subfield => 'a',
                subfields       => [ { code => 'a', value => 'Test title' } ]
            },
            features => {
                punctuation_explain => 1,
                subject_guidance    => 0,
                call_number_guidance => 0,
            }
        };
    }
    sub _csrf_ok { return 1; }
    sub _normalize_ai_request_payload { return $_[1]; }
    sub _validate_schema { return []; }
    sub _ai_key_available { return 0; }
    sub _json_response {
        my ( $self, $status, $payload ) = @_;
        return {
            status  => $status,
            payload => $payload
        };
    }
}

local $ENV{REQUEST_METHOD} = 'POST';
my $response = Koha::Plugin::Cataloging::AutoPunctuation::Api::ai_suggest(
    Local::AiEndpointHarness->new );

is( $response->{status}, '503 Service Unavailable',
    'disabled AI returns the mapped HTTP status' );
is_deeply(
    $response->{payload},
    {
        ok    => 0,
        error =>
          'AI features are disabled or missing API key for the selected provider.'
    },
    'ai_suggest reaches the JSON response helper on an expected early exit'
);

done_testing();
