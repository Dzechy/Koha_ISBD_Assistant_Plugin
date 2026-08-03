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

package Koha::Plugin::Cataloging::AutoPunctuation::Http;

use Modern::Perl;
use CGI;
use JSON qw(to_json from_json);
use Try::Tiny;

sub _clone_payload_hash {
    my ($payload) = @_;
    return {} unless defined $payload;
    return { %{$payload} } if ref $payload eq 'HASH';
    return { data  => $payload } if ref $payload eq 'ARRAY';
    return { value => "$payload" };
}

sub _api_response {
    my ( $self, $payload, $status, $extra_headers ) = @_;
    my $body = _clone_payload_hash($payload);
    my $cgi  = $self->{'cgi'} || CGI->new;

    $status = '200 OK' unless defined $status && $status ne '';
    my %header_args = (
        -status  => $status,
        -type    => 'application/json',
        -charset => 'utf-8'
    );

    if ( $extra_headers && ref $extra_headers eq 'HASH' ) {
        for my $name ( keys %{$extra_headers} ) {
            next unless defined $name && $name =~ /\A[A-Za-z0-9-]+\z/;
            my $value = $extra_headers->{$name};
            next if !defined $value || ref $value;
            $value = "$value";
            next if $value =~ /[\r\n]/;
            $header_args{"-$name"} = $value;
        }
    }

    print $cgi->header(%header_args);
    print to_json($body);

    # Koha's stock plugins/run.pl ignores the return value and expects plugin
    # methods to emit their own CGI response.  The marker lets the legacy
    # repository-local run.pl avoid emitting a second response.
    return { __response_emitted => 1 };
}

sub _emit_json {
    my ( $self, $payload, $status, $extra_headers ) = @_;
    return _api_response( $self, $payload || {}, $status, $extra_headers );
}

sub _json_response {
    my ( $self, $status, $payload, $extra_headers ) = @_;
    return _api_response( $self, $payload || {}, $status, $extra_headers );
}

sub _json_error {
    my ( $self, $status, $message, $extra ) = @_;
    my $payload = {
        ok    => 0,
        error => $message
    };
    if ( $extra && ref $extra eq 'HASH' ) {
        $payload = { %{$payload}, %{$extra} };
    }
    return _json_response( $self, $status, $payload );
}

sub _emit_json_error {
    my ( $self, $message, $status ) = @_;
    return _json_error( $self, $status, $message );
}

sub _max_json_payload_bytes {
    return 512 * 1024;
}

sub _json_payload_too_large {
    my ( $self, $max_bytes ) = @_;
    my $limit = $max_bytes || _max_json_payload_bytes( $self, );
    return {
        ok      => 0,
        error   => 'JSON payload too large.',
        details => "Request body exceeds ${limit} bytes.",
        status  => '413 Payload Too Large'
    };
}

sub _content_length_value {
    my ($self) = @_;
    my $raw = $ENV{CONTENT_LENGTH};
    return undef unless defined $raw && $raw ne '';
    return undef unless $raw =~ /^\d+$/;
    return int($raw);
}

sub _read_psgi_body_limited {
    my ( $self, $max_bytes ) = @_;
    return { ok => 1, body => '' } unless $ENV{'psgi.input'};
    my $limit           = $max_bytes || _max_json_payload_bytes( $self, );
    my $declared_length = _content_length_value( $self, );
    if ( defined $declared_length && $declared_length > $limit ) {
        return _json_payload_too_large( $self, $limit );
    }

    my $fh   = $ENV{'psgi.input'};
    my $body = '';
    if ( defined $declared_length && $declared_length > 0 ) {
        my $bytes_read = read( $fh, $body, $declared_length );
        return { ok => 1, body => '' } unless defined $bytes_read;
    }
    else {
        my $chunk = '';
        while (1) {
            my $bytes_read = read( $fh, $chunk, 8192 );
            last unless $bytes_read;
            $body .= $chunk;
            if ( length($body) > $limit ) {
                return _json_payload_too_large( $self, $limit );
            }
        }
    }
    if ( length($body) > $limit ) {
        return _json_payload_too_large( $self, $limit );
    }
    return { ok => 1, body => $body };
}

sub _read_json_param_limited {
    my ( $self, $cgi, $max_bytes ) = @_;
    my $limit = $max_bytes || _max_json_payload_bytes( $self, );
    my $json_input =
         $cgi->param('POSTDATA')
      || $cgi->param('json')
      || $cgi->param('payload')
      || '';
    return { ok => 1, body => '' } unless $json_input;
    if ( length($json_input) > $limit ) {
        return _json_payload_too_large( $self, $limit );
    }
    return { ok => 1, body => $json_input };
}

sub _read_json_body {
    my ($self)       = @_;
    my $cgi          = $self->{'cgi'} || CGI->new;
    my $content_type = lc( $cgi->content_type || $ENV{CONTENT_TYPE} || '' );
    my $is_json      = $content_type =~ m{application/json};
    my $max_bytes    = _max_json_payload_bytes( $self, );

    my $parse_json = sub {
        my ($json_input) = @_;
        return { ok => 1, data => {} } unless $json_input;
        my $data;
        try {
            $data = from_json($json_input);
        }
        catch {
            my $message = "$_";
            $message =~ s/\s+$//;
            return {
                ok      => 0,
                error   => 'Invalid JSON input',
                details => $message,
                status  => '400 Bad Request'
            };
        };
        return {
            ok     => 0,
            error  => 'JSON payload must be an object.',
            status => '400 Bad Request'
          }
          unless ref $data eq 'HASH';
        return { ok => 1, data => $data };
    };

    my $json_input = '';
    if ($is_json) {
        my $body_read = _read_psgi_body_limited( $self, $max_bytes );
        return $body_read unless $body_read->{ok};
        $json_input = $body_read->{body} || '';
    }
    if ( !$json_input ) {
        my $param_read = _read_json_param_limited( $self, $cgi, $max_bytes );
        return $param_read unless $param_read->{ok};
        $json_input = $param_read->{body} || '';
    }
    return $parse_json->($json_input) if $is_json || $json_input;

    my %vars = $cgi->Vars;
    return { ok => 1, data => \%vars };
}

sub _current_user_id {
    my ($self) = @_;
    my $cgi    = $self->{'cgi'} || CGI->new;
    return $cgi->remote_user || $ENV{REMOTE_USER} || '';
}

sub _require_permission {
    return 1;
}

sub _require_method {
    my ( $self, $method ) = @_;
    my $request_method = $ENV{REQUEST_METHOD} || '';
    return $request_method eq $method ? 1 : 0;
}

sub _read_json_payload {
    my ($self)     = @_;
    my $cgi        = $self->{'cgi'} || CGI->new;
    my $max_bytes  = _max_json_payload_bytes( $self, );
    my $json_input = '';
    my $content_type = lc( $cgi->content_type || $ENV{CONTENT_TYPE} || '' );
    my $is_json      = $content_type =~ m{application/json};

    if ( $is_json && $ENV{'psgi.input'} ) {
        my $body_read = _read_psgi_body_limited( $self, $max_bytes );
        return {
            error   => $body_read->{error},
            details => $body_read->{details},
            status  => $body_read->{status}
          }
          unless $body_read->{ok};
        $json_input = $body_read->{body} || '';
    }
    if ( !$json_input ) {
        my $param_read = _read_json_param_limited( $self, $cgi, $max_bytes );
        return {
            error   => $param_read->{error},
            details => $param_read->{details},
            status  => $param_read->{status}
          }
          unless $param_read->{ok};
        $json_input = $param_read->{body} || '';
    }
    if ( !$json_input ) {
        my %vars = $cgi->Vars;
        return \%vars if %vars;
        return {};
    }
    my $data;
    try {
        $data = from_json($json_input);
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        return {
            error   => 'Invalid JSON input',
            details => $message,
            status  => '400 Bad Request'
        };
    };
    return {
        error  => 'JSON payload must be an object.',
        status => '400 Bad Request'
      }
      unless ref $data eq 'HASH';
    return $data;
}

1;
