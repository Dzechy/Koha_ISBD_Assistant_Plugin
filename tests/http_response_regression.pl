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
use JSON qw(from_json);

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::Http;

my $http = bless { cgi => CGI->new },
  'Koha::Plugin::Cataloging::AutoPunctuation::Http';

sub capture_response {
    my ($callback) = @_;
    my $output = '';
    my $return;
    {
        open my $capture, '>', \$output or die "Cannot capture output: $!";
        local *STDOUT = $capture;
        $return = $callback->();
    }
    return ( $output, $return );
}

my ( $success_output, $success_return ) = capture_response(
    sub {
        return $http->_json_response( '200 OK', { ok => 1, users => [] } );
    }
);

like( $success_output, qr/Content-Type: application\/json; charset=utf-8/i,
    'JSON content type is emitted' );
my ( $success_headers, $success_body ) = split /\r?\n\r?\n/,
  $success_output, 2;
is_deeply( from_json($success_body), { ok => 1, users => [] },
    'success payload is emitted as JSON' );
ok( $success_return->{__response_emitted},
    'response marker is returned for legacy dispatcher compatibility' );

my ( $error_output, $error_return ) = capture_response(
    sub {
        return $http->_json_error( '502 Bad Gateway', 'Provider unavailable' );
    }
);

like( $error_output, qr/Status: 502 Bad Gateway/i,
    'non-success HTTP status is emitted' );
my ( $error_headers, $error_body ) = split /\r?\n\r?\n/, $error_output, 2;
is_deeply(
    from_json($error_body),
    { ok => 0, error => 'Provider unavailable' },
    'error payload is emitted as JSON'
);
ok( $error_return->{__response_emitted},
    'error response returns the emitted marker' );

{
    package Local::FormCGI;

    sub new {
        my ( $class, $params ) = @_;
        return bless { params => $params || {} }, $class;
    }

    sub content_type { return 'application/x-www-form-urlencoded'; }

    sub param {
        my ( $self, $name ) = @_;
        return $self->{params}{$name};
    }

    sub Vars {
        my ($self) = @_;
        return %{ $self->{params} };
    }
}

my $form_cgi = Local::FormCGI->new(
    {
        class   => 'Koha::Plugin::Cataloging::AutoPunctuation',
        method  => 'ai_models',
        op      => 'cud-plugin_api',
        payload => '{"provider":"openrouter","force":1}'
    }
);
my $form_http = bless { cgi => $form_cgi },
  'Koha::Plugin::Cataloging::AutoPunctuation::Http';
my $raw_form_body = 'payload=%7B%22wrong%22%3A1%7D';
open my $psgi_input, '<', \$raw_form_body
  or die "Cannot create PSGI input: $!";
{
    local $ENV{'psgi.input'} = $psgi_input;
    local $ENV{CONTENT_TYPE} = 'application/x-www-form-urlencoded';
    is_deeply(
        $form_http->_read_json_payload(),
        { provider => 'openrouter', force => 1 },
        'form payload is read from CGI params without consuming raw PSGI form data'
    );
}

done_testing();
