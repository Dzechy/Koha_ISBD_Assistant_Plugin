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

package Koha::Plugin::Cataloging::AutoPunctuation::Security;

use Modern::Perl;
use C4::Auth;
use C4::Context;
use Koha::Patrons;
use Koha::Token;
use CGI;
use Try::Tiny;
use Digest::SHA  qw(sha256);
use MIME::Base64 qw(encode_base64 decode_base64);
use Crypt::Mode::CBC;
use Crypt::PRNG;

sub _normalize_csrf_token_value {
    my ($value) = @_;
    return '' unless defined $value;
    if ( ref $value eq 'ARRAY' ) {
        return '' unless @{$value};
        $value = $value->[0];
    }
    return '' if ref $value;
    my $token = "$value";
    $token =~ s/[\r\n]//g;
    $token =~ s/^\s+|\s+$//g;
    return '' unless $token ne '';
    return $token;
}

sub _normalize_session_id_value {
    my ($value) = @_;
    return '' unless defined $value;
    if ( ref $value eq 'ARRAY' ) {
        return '' unless @{$value};
        $value = $value->[0];
    }
    return '' if ref $value;
    my $session_id = "$value";
    $session_id =~ s/[\r\n]//g;
    $session_id =~ s/^\s+|\s+$//g;
    return '' unless $session_id ne '';
    if ( $session_id =~ /[\0,]/ ) {
        my @parts = grep { defined $_ && $_ ne '' } map {
            my $part = $_;
            $part =~ s/^\s+|\s+$//g;
            $part;
        } split( /[\0,]/, $session_id );
        return $parts[0] || '';
    }
    return $session_id;
}

sub _normalize_identity_value {
    my ($value) = @_;
    return '' unless defined $value;
    if ( ref $value eq 'ARRAY' ) {
        return '' unless @{$value};
        $value = $value->[0];
    }
    return '' if ref $value;
    my $identity = "$value";
    $identity =~ s/[\r\n]//g;
    $identity =~ s/^\s+|\s+$//g;
    return '' unless $identity ne '';
    return lc($identity);
}

sub _plugin_csrf_token {
    my ( $self, $session_id ) = @_;
    $session_id = _normalize_session_id_value($session_id);
    return '' unless $session_id;
    my $token = '';
    try {
        $token =
          Koha::Token->new->generate_csrf( { session_id => $session_id } )
          || '';
    }
    catch {
        $token = '';
    };
    return _normalize_csrf_token_value($token);
}

sub _cud_plugin_dispatch_ok {
    my ($self) = @_;
    my $cgi = $self->{'cgi'} || CGI->new;
    my $op = $cgi->param('op') || '';
    return $op eq 'cud-plugin_api' ? 1 : 0;
}

sub _csrf_token_fingerprint {
    my ($value) = @_;
    return '' unless defined $value && $value ne '';
    my $len  = length($value);
    my $head = substr( $value, 0, 8 );
    return $head . ':' . $len;
}

sub _session_id_fingerprint {
    my ($value) = @_;
    return '' unless defined $value && $value ne '';
    my $len  = length($value);
    my $head = substr( $value, 0, 6 );
    my $tail = substr( $value, -4 );
    return $head . '...' . $tail . ':' . $len;
}

sub _identity_fingerprint {
    my ($value) = @_;
    return '' unless defined $value && $value ne '';
    my $len  = length($value);
    my $head = substr( $value, 0, 4 );
    return $head . ':' . $len;
}

sub _csrf_identity_id {
    my ($self) = @_;
    my $cgi    = $self->{'cgi'} || CGI->new;
    my $id     = '';

    my $userenv = C4::Context->userenv;
    if ( $userenv && ref $userenv eq 'HASH' ) {
        $id = $userenv->{userid} || $userenv->{user} || '';
    }

    if ( !$id ) {
        my $session = _current_session( $self, );
        if ( $session && $session->can('param') ) {
            $id =
                 $session->param('userid')
              || $session->param('user')
              || $session->param('username')
              || '';
        }
    }

    if ( !$id ) {
        $id = $cgi->remote_user || $ENV{REMOTE_USER} || '';
    }
    $id =~ s/^\s+|\s+$//g if defined $id;
    return $id || '';
}

sub _session_id_from_request {
    my ($self) = @_;
    my $cgi = $self->{'cgi'} || CGI->new;
    my @candidates;

    my $cookie_session =
      _normalize_session_id_value( scalar $cgi->cookie('CGISESSID') );
    push @candidates, $cookie_session if $cookie_session ne '';

    my $cookie_header = $ENV{HTTP_COOKIE} || '';
    if ( $cookie_header =~ /(?:^|;\s*)CGISESSID=([^;]+)/i ) {
        my $header_session = _normalize_session_id_value($1);
        push @candidates, $header_session if $header_session ne '';
    }

    my $userenv = C4::Context->userenv;
    if ( $userenv && ref $userenv eq 'HASH' ) {
        push @candidates,
          grep { $_ ne '' } map { _normalize_session_id_value($_); } (
            $userenv->{session_id},
            $userenv->{sessionID}, $userenv->{sessionid},
          );
    }

    if ( C4::Context->can('session') ) {
        my $context_session = C4::Context->session;
        if ( $context_session && $context_session->can('id') ) {
            my $context_session_id =
              _normalize_session_id_value( $context_session->id );
            push @candidates, $context_session_id if $context_session_id ne '';
        }
    }

    if ( !@candidates ) {
        for my $name ( $cgi->cookie ) {
            next unless $name && $name =~ /sess/i;
            my $value =
              _normalize_session_id_value( scalar $cgi->cookie($name) );
            next unless $value;
            push @candidates, $value;
            last;
        }
    }

    my %seen;
    @candidates = grep { defined $_ && $_ ne '' && !$seen{$_}++ } @candidates;
    return $candidates[0] || '';
}

sub _current_session {
    my ($self) = @_;
    return undef unless C4::Auth->can('get_session');
    my $session_id = _session_id_from_request( $self, );
    return undef unless $session_id;
    my $session;
    try {
        $session = C4::Auth::get_session($session_id);
    }
    catch {
        $session = undef;
    };
    return $session;
}

sub _session_id {
    my ($self) = @_;
    return _session_id_from_request( $self, );
}

sub _csrf_ok {
    my ( $self, $payload ) = @_;
    my $cgi = $self->{'cgi'} || CGI->new;
    $self->{_csrf_debug_info} = {};
    my @header_candidates = (
        $cgi->http('X-CSRF-Token'), $cgi->http('CSRF-TOKEN'),
        $ENV{HTTP_X_CSRF_TOKEN},    $ENV{HTTP_CSRF_TOKEN},
    );
    my @header_tokens = grep { $_ ne '' }
      map { _normalize_csrf_token_value($_) } @header_candidates;
    my %header_seen;
    @header_tokens = grep { !$header_seen{$_}++ } @header_tokens;
    if ( @header_tokens > 1 ) {
        $self->{_csrf_debug_info} = {
            reason                    => 'multiple_header_tokens',
            header_token_fingerprints =>
              [ map { _csrf_token_fingerprint($_) } @header_tokens ],
        };
        return 0;
    }
    my $header_token = @header_tokens ? $header_tokens[0] : '';

    my $payload_token = '';
    if ( $payload && ref $payload eq 'HASH' && exists $payload->{csrf_token} ) {
        $payload_token = _normalize_csrf_token_value( $payload->{csrf_token} );
    }
    my $param_token =
      _normalize_csrf_token_value( $cgi->param('csrf_token') || '' );

    if ( $header_token && $payload_token && $header_token ne $payload_token ) {
        $self->{_csrf_debug_info} = {
            reason                    => 'header_payload_mismatch',
            header_token_fingerprint  => _csrf_token_fingerprint($header_token),
            payload_token_fingerprint =>
              _csrf_token_fingerprint($payload_token),
            param_token_fingerprint => _csrf_token_fingerprint($param_token),
        };
        return 0;
    }
    if ( $header_token && $param_token && $header_token ne $param_token ) {
        $self->{_csrf_debug_info} = {
            reason                    => 'header_param_mismatch',
            header_token_fingerprint  => _csrf_token_fingerprint($header_token),
            payload_token_fingerprint =>
              _csrf_token_fingerprint($payload_token),
            param_token_fingerprint => _csrf_token_fingerprint($param_token),
        };
        return 0;
    }
    my $csrf_token = $header_token || $payload_token || $param_token || '';
    unless ($csrf_token) {
        $self->{_csrf_debug_info} = {
            reason                    => 'missing_token',
            header_token_fingerprint  => _csrf_token_fingerprint($header_token),
            payload_token_fingerprint =>
              _csrf_token_fingerprint($payload_token),
            param_token_fingerprint => _csrf_token_fingerprint($param_token),
        };
        return 0;
    }

    my @session_candidates;
    my $cookie_session =
      _normalize_session_id_value( scalar $cgi->cookie('CGISESSID') );
    push @session_candidates, $cookie_session if $cookie_session ne '';

    my $self_session = _normalize_session_id_value( _session_id( $self, ) );
    push @session_candidates, $self_session if $self_session ne '';

    my $cookie_header = $ENV{HTTP_COOKIE} || '';
    if ( $cookie_header =~ /(?:^|;\s*)CGISESSID=([^;]+)/i ) {
        my $header_session = _normalize_session_id_value($1);
        push @session_candidates, $header_session if $header_session ne '';
    }

    my %session_seen;
    @session_candidates =
      grep { defined $_ && $_ ne '' && !$session_seen{$_}++ }
      @session_candidates;
    unless (@session_candidates) {
        $self->{_csrf_debug_info} = {
            reason            => 'missing_session',
            token_fingerprint => _csrf_token_fingerprint($csrf_token),
        };
        return 0;
    }

    my @checks;
    for my $session_id (@session_candidates) {
        my $ok = 0;
        try {
            $ok = Koha::Token->new->check_csrf(
                {
                    session_id => $session_id,
                    token      => $csrf_token,
                }
            ) ? 1 : 0;
        }
        catch {
            $ok = 0;
        };
        push @checks,
          {
            session_id_fingerprint => _session_id_fingerprint($session_id),
            ok                     => $ok,
          };
        return 1 if $ok;
    }
    $self->{_csrf_debug_info} = {
        reason                    => 'koha_token_mismatch',
        token_fingerprint         => _csrf_token_fingerprint($csrf_token),
        header_token_fingerprint  => _csrf_token_fingerprint($header_token),
        payload_token_fingerprint => _csrf_token_fingerprint($payload_token),
        param_token_fingerprint   => _csrf_token_fingerprint($param_token),
        session_checks            => \@checks,
    };
    return 0;
}

sub _csrf_debug_info {
    my ($self) = @_;
    return {} unless $self && ref $self;
    return $self->{_csrf_debug_info} || {};
}

sub _authenticated_user_identity {
    my ($self)         = @_;
    my $cgi            = $self->{'cgi'} || CGI->new;
    my $borrowernumber = '';
    my $userid         = '';

    my $userenv = C4::Context->userenv;
    if ( $userenv && ref $userenv eq 'HASH' ) {
        $borrowernumber =
          $userenv->{borrowernumber} || $userenv->{number} || '';
        $userid =
          $userenv->{userid} || $userenv->{user} || $userenv->{id} || '';
    }

    if ( !$borrowernumber || !$userid ) {
        my $session = _current_session( $self, );
        if ( $session && $session->can('param') ) {
            $borrowernumber ||=
                 $session->param('number')
              || $session->param('borrowernumber')
              || $session->param('patron_id')
              || $session->param('borrower_id')
              || '';
            $userid ||=
                 $session->param('id')
              || $session->param('userid')
              || $session->param('user')
              || $session->param('username')
              || '';
        }
    }

    $borrowernumber =~ s/^\s+|\s+$//g if defined $borrowernumber;
    $userid         =~ s/^\s+|\s+$//g if defined $userid;
    $borrowernumber = '' unless defined $borrowernumber;
    $userid         = '' unless defined $userid;

    if ( !$borrowernumber && $userid ) {
        my $patron = Koha::Patrons->find( { userid => $userid } );
        $borrowernumber = $patron->borrowernumber
          if $patron && $patron->borrowernumber;
    }
    elsif ( !$userid && $borrowernumber =~ /^\d+$/ ) {
        my $patron = Koha::Patrons->find($borrowernumber);
        $userid = $patron->userid if $patron && $patron->userid;
    }

    if ( !$userid ) {
        $userid = $cgi->remote_user || $ENV{REMOTE_USER} || '';
        $userid =~ s/^\s+|\s+$//g if defined $userid;
    }

    return {
        borrowernumber => $borrowernumber || '',
        userid         => $userid         || '',
    };
}

sub _is_authenticated_staff_session {
    my ($self) = @_;
    my $identity = _authenticated_user_identity( $self, );
    return ( ( $identity->{borrowernumber} || '' ) ne ''
          || ( $identity->{userid} || '' ) ne '' ) ? 1 : 0;
}

sub _secret_present {
    my ( $self, $value ) = @_;
    return ( $value && $value ne '' ) ? 1 : 0;
}

sub _secret_is_encrypted {
    my ( $self, $value ) = @_;
    return 0 unless defined $value && $value ne '';
    return $value =~ /^(KOHAENC|ENCv1|ENCv2):/ ? 1 : 0;
}

sub _koha_encryptor {
    my ($self) = @_;
    my $crypt;
    try {
        require Koha::Encryption;
        $crypt = Koha::Encryption->new;
    }
    catch {
        $crypt = undef;
    };
    return $crypt;
}

sub _encryption_secret {
    my ($self) = @_;
    my $secret = C4::Context->config('encryption_key') // '';
    $secret =~ s/^\s+|\s+$//g;
    return '' unless $secret;
    return ''
      if $secret =~
/^(changeme|change_me|replace_me|your_secret_here|set_me|set_this|encryption_key)$/i;
    return $secret;
}

sub _encryption_error_message {
    return 'Koha encryption_key is not configured in koha-conf.xml';
}

sub _encrypt_secret {
    my ( $self, $plaintext ) = @_;
    return undef unless defined $plaintext && $plaintext ne '';
    my $secret = _encryption_secret( $self, );
    return undef unless $secret;
    if ( my $crypt = _koha_encryptor( $self, ) ) {
        return 'KOHAENC:' . $crypt->encrypt_hex($plaintext);
    }
    my $key = sha256($secret);
    my $iv  = Crypt::PRNG::random_bytes(12);
    my $gcm;
    try {
        require Crypt::Mode::GCM;
        $gcm = Crypt::Mode::GCM->new('AES');
    }
    catch {
        $gcm = undef;
    };
    if ($gcm) {
        my $tag;
        my $ciphertext = $gcm->encrypt( $plaintext, $key, $iv, '', $tag );
        return 'ENCv2:' . encode_base64( $iv . $tag . $ciphertext, '' );
    }
    $iv = Crypt::PRNG::random_bytes(16);
    my $cbc        = Crypt::Mode::CBC->new( 'AES', 1 );
    my $ciphertext = $cbc->encrypt( $plaintext, $key, $iv );
    return 'ENCv1:' . encode_base64( $iv . $ciphertext, '' );
}

sub _decrypt_secret {
    my ( $self, $ciphertext ) = @_;
    return '' unless defined $ciphertext && $ciphertext ne '';
    if ( $ciphertext =~ /^KOHAENC:(.+)$/ ) {
        return '' unless _encryption_secret( $self, );
        my $crypt = _koha_encryptor( $self, );
        return '' unless $crypt;
        my $decoded = $1;
        my $plaintext;
        try {
            $plaintext = $crypt->decrypt_hex($decoded);
        }
        catch {
            $plaintext = '';
        };
        return $plaintext // '';
    }
    if ( $ciphertext =~ /^ENCv1:(.+)$/ ) {
        my $secret = _encryption_secret( $self, );
        return '' unless $secret;
        my $raw = decode_base64($1);
        return '' unless defined $raw && length($raw) > 16;
        my $iv        = substr( $raw, 0, 16 );
        my $encrypted = substr( $raw, 16 );
        my $cbc       = Crypt::Mode::CBC->new( 'AES', 1 );
        my $plaintext = '';
        try {
            $plaintext = $cbc->decrypt( $encrypted, sha256($secret), $iv );
        }
        catch {
            $plaintext = '';
        };
        return $plaintext // '';
    }
    if ( $ciphertext =~ /^ENCv2:(.+)$/ ) {
        my $secret = _encryption_secret( $self, );
        return '' unless $secret;
        my $raw = decode_base64($1);
        return '' unless defined $raw && length($raw) > 28;
        my $iv        = substr( $raw, 0,  12 );
        my $tag       = substr( $raw, 12, 16 );
        my $encrypted = substr( $raw, 28 );
        my $gcm;
        try {
            require Crypt::Mode::GCM;
            $gcm = Crypt::Mode::GCM->new('AES');
        }
        catch {
            $gcm = undef;
        };
        return '' unless $gcm;
        my $plaintext = '';
        try {
            $plaintext =
              $gcm->decrypt( $encrypted, sha256($secret), $iv, '', $tag );
        }
        catch {
            $plaintext = '';
        };
        return $plaintext // '';
    }
    return '';
}

sub _obfuscate_secret {
    my ( $self, $plaintext, $seed ) = @_;
    return '' unless defined $plaintext && $plaintext ne '';
    my $mask = defined $seed ? $seed : 73;
    my $obfuscated =
      join( '', map { chr( ord($_) ^ $mask ) } split //, $plaintext );
    return encode_base64( $obfuscated, '' );
}

sub _migrate_secret {
    my ( $self, $value, $errors ) = @_;
    return '' unless defined $value && $value ne '';
    if ( _secret_is_encrypted( $self, $value ) ) {
        if ( $value =~ /^ENCv1:/ ) {
            my $plaintext = _decrypt_secret( $self, $value );
            my $encrypted = _encrypt_secret( $self, $plaintext );
            return $encrypted if defined $encrypted && $encrypted ne '';
        }
        return $value;
    }
    unless ( _encryption_secret( $self, ) ) {
        push @{$errors}, _encryption_error_message( $self, )
          if $errors && ref $errors eq 'ARRAY';
        return $value;
    }
    my $encrypted = _encrypt_secret( $self, $value );
    return $encrypted if defined $encrypted && $encrypted ne '';
    push @{$errors}, _encryption_error_message( $self, )
      if $errors && ref $errors eq 'ARRAY';
    return $value;
}

1;
