# This file is part of Koha.

package Koha::Plugin::Cataloging::AutoPunctuation::AI::AuthorityCache;

use Modern::Perl;
use Time::HiRes qw(time);

my %AUTHORITY_CACHE;
my @AUTHORITY_CACHE_LRU;

sub _authority_cache_backend {
    my ($self) = @_;
    return $self->{_authority_cache_backend}
      if exists $self->{_authority_cache_backend};
    my $cache;
    eval {
        require Koha::Cache;
        $cache = Koha::Cache->get_instance();
        1;
    } or $cache = undef;
    $self->{_authority_cache_backend} = $cache;
    return $cache;
}

sub _authority_cache_key {
    my ( $scheme, $adapter_version, $query ) = @_;
    return join( ':', 'isbd_authority', lc( $scheme || 'unknown' ),
        $adapter_version || '1', $query || '' );
}

sub _authority_cache_get {
    my ( $self, $settings, $scheme, $adapter_version, $query ) = @_;
    my $key = _authority_cache_key( $scheme, $adapter_version, $query );
    if ( my $cache = _authority_cache_backend($self) ) {
        return $cache->get_from_cache($key) if $cache->can('get_from_cache');
        return $cache->get($key)            if $cache->can('get');
        return;
    }
    my $entry = $AUTHORITY_CACHE{$key};
    return unless $entry;
    if ( $entry->{expires} < time ) {
        delete $AUTHORITY_CACHE{$key};
        @AUTHORITY_CACHE_LRU = grep { $_ ne $key } @AUTHORITY_CACHE_LRU;
        return;
    }
    @AUTHORITY_CACHE_LRU = grep { $_ ne $key } @AUTHORITY_CACHE_LRU;
    push @AUTHORITY_CACHE_LRU, $key;
    return $entry->{value};
}

sub _authority_cache_set {
    my ( $self, $settings, $scheme, $adapter_version, $query, $value ) = @_;
    return unless $value && ref $value eq 'HASH';
    my $status = $value->{status} || '';
    return if $status =~ /^(?:service_unavailable|invalid_authority_response)$/;

    my $key = _authority_cache_key( $scheme, $adapter_version, $query );
    my $ttl = int( $settings->{loc_authority_cache_ttl_seconds} || 86400 );
    $ttl = 60 if $ttl < 60;
    if ( my $cache = _authority_cache_backend($self) ) {
        my $options = { expiry => $ttl };
        return $cache->set_in_cache( $key, $value, $options )
          if $cache->can('set_in_cache');
        return $cache->set( $key, $value, $options ) if $cache->can('set');
        return;
    }
    $AUTHORITY_CACHE{$key} = { value => $value, expires => time + $ttl };
    @AUTHORITY_CACHE_LRU = grep { $_ ne $key } @AUTHORITY_CACHE_LRU;
    push @AUTHORITY_CACHE_LRU, $key;
    my $limit = int( $settings->{loc_authority_cache_max_entries} || 1000 );
    $limit = 50 if $limit < 50;
    while ( @AUTHORITY_CACHE_LRU > $limit ) {
        my $oldest = shift @AUTHORITY_CACHE_LRU;
        delete $AUTHORITY_CACHE{$oldest};
    }
    return 1;
}

1;
