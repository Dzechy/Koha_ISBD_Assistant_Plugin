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

package Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress;

use Modern::Perl;
use JSON qw(to_json from_json);
use Try::Tiny;
use Koha::Patrons;
use C4::Context;
use CGI;
use Digest::SHA  qw(sha1_hex);
use Scalar::Util qw(looks_like_number blessed);

sub _guide_progress_key {
    my ( $self, $user_key ) = @_;
    return '' unless defined $user_key && $user_key ne '';
    $user_key =~ s/^\s+|\s+$//g;
    return '' unless $user_key ne '';
    return 'guide_progress:' . $user_key;
}

sub _load_guide_progress_index {
    my ( $self, $settings ) = @_;
    my $map = _load_guide_progress_map( $self, $settings );
    if ( $map && ref $map eq 'HASH' && %{$map} ) {
        my @list = grep { defined $_ && $_ ne '' } sort keys %{$map};
        return \@list;
    }
    my $raw =
      $self->_safe_retrieve_data( 'guide_progress_index', $settings,
        'guide_progress_index' )
      || '';
    return [] unless $raw;
    my $data = [];
    try {
        $data = from_json($raw);
    }
    catch {
        $data = [];
    };
    if ( ref $data eq 'ARRAY' ) {
        my @list = grep { defined $_ && $_ ne '' } @{$data};
        return \@list;
    }
    if ( ref $data eq 'HASH' ) {
        if ( $data->{users} && ref $data->{users} eq 'ARRAY' ) {
            my @list = grep { defined $_ && $_ ne '' } @{ $data->{users} };
            return \@list;
        }
        if ( $data->{users} && ref $data->{users} eq 'HASH' ) {
            my @list =
              grep { defined $_ && $_ ne '' } sort keys %{ $data->{users} };
            return \@list;
        }
        my @list = grep { defined $_ && $_ ne '' } sort keys %{$data};
        return \@list;
    }
    return [];
}

sub _save_guide_progress_index {
    my ( $self, $list, $settings ) = @_;
    $list = [] unless $list && ref $list eq 'ARRAY';
    $self->_safe_store_data( { guide_progress_index => to_json($list) },
        $settings, 'guide_progress_index' );
}

sub _load_guide_progress_map {
    my ( $self, $settings ) = @_;
    my $raw =
      $self->_safe_retrieve_data( 'guide_progress_v2', $settings,
        'guide_progress_v2' )
      || '{}';
    my $data = {};
    try {
        $data = from_json($raw);
    }
    catch {
        $data = {};
    };
    return $data if ref $data eq 'HASH';
    return {};
}

sub _save_guide_progress_map {
    my ( $self, $map, $settings ) = @_;
    $map = {} unless $map && ref $map eq 'HASH';
    return $self->_safe_store_data( { guide_progress_v2 => to_json($map) },
        $settings, 'guide_progress_v2' );
}

sub _load_guide_progress_entry {
    my ( $self, $user_key, $settings ) = @_;
    my $map = _load_guide_progress_map( $self, $settings );
    if ( $map && ref $map eq 'HASH' && $user_key && exists $map->{$user_key} ) {
        return $map->{$user_key} || {};
    }
    my $key = _guide_progress_key( $self, $user_key );
    return {} unless $key;
    my $raw  = $self->_safe_retrieve_data( $key, $settings, $key ) || '{}';
    my $data = {};
    try {
        $data = from_json($raw);
    }
    catch {
        $data = {};
    };
    return $data;
}

sub _save_guide_progress_entry {
    my ( $self, $user_key, $data, $settings ) = @_;
    return unless defined $user_key && $user_key ne '';
    my $map = _load_guide_progress_map( $self, $settings );
    $map = {} unless $map && ref $map eq 'HASH';
    $map->{$user_key} = $data || {};
    return _save_guide_progress_map( $self, $map, $settings );
}

sub _normalize_progress_list {
    my ( $self, $value ) = @_;
    my @items;
    if ( ref $value eq 'ARRAY' ) {
        @items = @{$value};
    }
    elsif ( defined $value ) {
        my $raw = $value;
        @items = split( /[\0,]+/, $raw );
    }
    @items = grep { defined $_ && !ref $_ } @items;
    @items = map {
        my $v = defined $_ ? $_ : '';
        $v =~ s/^\s+|\s+$//g;
        $v;
    } @items;
    @items = grep { $_ ne '' } @items;
    return \@items;
}

sub _summary_counts_from_payload {
    my ( $self, $summary, $completed, $skipped ) = @_;
    my $completed_count =
      ( ref $completed eq 'ARRAY' ) ? scalar @{$completed} : 0;
    my $skipped_count = ( ref $skipped eq 'ARRAY' ) ? scalar @{$skipped} : 0;
    my $total         = $completed_count + $skipped_count;
    if ( $summary && ref $summary eq 'HASH' ) {
        my $maybe_total =
             $summary->{total}
          || $summary->{steps_total}
          || $summary->{stepsTotal};
        if ( defined $maybe_total && looks_like_number($maybe_total) ) {
            $total = int($maybe_total);
        }
    }
    return {
        completed_count => $completed_count,
        skipped_count   => $skipped_count,
        total           => $total
    };
}

sub _normalize_progress_counter_hash {
    my ($value) = @_;
    return {} unless $value && ref $value eq 'HASH';
    my %normalized;
    for my $key ( keys %{$value} ) {
        next unless defined $key;
        my $name = "$key";
        $name =~ s/^\s+|\s+$//g;
        next unless $name ne '';
        my $entry = $value->{$key};
        next unless $entry && ref $entry eq 'HASH';
        my $total =
          looks_like_number( $entry->{total} ) ? int( $entry->{total} ) : 0;
        my $completed =
          looks_like_number( $entry->{completed} )
          ? int( $entry->{completed} )
          : 0;
        my $skipped =
          looks_like_number( $entry->{skipped} ) ? int( $entry->{skipped} ) : 0;
        $total     = 0 if $total < 0;
        $completed = 0 if $completed < 0;
        $skipped   = 0 if $skipped < 0;
        my $done = $completed + $skipped;
        $total = $done if $total < $done;
        $normalized{$name} = {
            total     => $total,
            completed => $completed,
            skipped   => $skipped
        };
    }
    return \%normalized;
}

sub _sanitize_progress_label {
    my ( $value, $max_length ) = @_;
    return '' unless defined $value;
    my $text = "$value";
    $text =~ s/\s+/ /g;
    $text =~ s/^\s+|\s+$//g;
    return '' unless $text ne '';
    my $limit =
      ( defined $max_length && looks_like_number($max_length) )
      ? int($max_length)
      : 160;
    $limit = 1 if $limit < 1;

    if ( length($text) > $limit ) {
        $text = substr( $text, 0, $limit );
        $text =~ s/\s+$//g;
    }
    return $text;
}

sub _normalize_progress_label_list {
    my ( $value, $limit, $max_length ) = @_;
    return [] unless $value && ref $value eq 'ARRAY';
    $limit      = 30  unless defined $limit      && looks_like_number($limit);
    $max_length = 240 unless defined $max_length && looks_like_number($max_length);
    my @items;
    for my $item ( @{$value} ) {
        last if @items >= $limit;
        next if ref $item;
        my $label = _sanitize_progress_label( $item, $max_length );
        push @items, $label if $label ne '';
    }
    return \@items;
}

sub _bounded_training_value {
    my ( $value, $depth ) = @_;
    $depth ||= 0;
    return undef if $depth > 7;
    if ( blessed($value) ) {
        return $value ? JSON::true : JSON::false;
    }
    if ( ref $value eq 'HASH' ) {
        my %copy;
        my $count = 0;
        for my $key ( sort keys %{$value} ) {
            last if $count++ >= 200;
            my $safe_key = _sanitize_progress_label( $key, 120 );
            next unless $safe_key ne '';
            $copy{$safe_key} = _bounded_training_value( $value->{$key}, $depth + 1 );
        }
        return \%copy;
    }
    if ( ref $value eq 'ARRAY' ) {
        my @copy;
        for my $item ( @{$value} ) {
            last if @copy >= 100;
            push @copy, _bounded_training_value( $item, $depth + 1 );
        }
        return \@copy;
    }
    return undef if ref $value;
    return $value if defined $value && looks_like_number($value);
    return _sanitize_progress_label( $value, 2000 );
}

sub _normalize_training_progress {
    my ( $self, $value ) = @_;
    return {} unless $value && ref $value eq 'HASH';
    my %allowed = map { $_ => 1 } qw(
      engine_version course_version guide_version rules_version onboarding
      current_module current_lesson current_step module_progress lesson_progress
      exercise_attempts draft_answers reflections quiz_results hint_usage revealed_answers skill_mastery
      mistakes review_recommendations requires_review assessment_results
      recent_activity last_activity advanced_mode
    );
    my %normalized;
    for my $key ( sort keys %{$value} ) {
        next unless $allowed{$key};
        $normalized{$key} = _bounded_training_value( $value->{$key}, 0 );
    }
    return \%normalized;
}

sub _completion_tier_label {
    my ($completion_percent) = @_;
    my $percent =
      ( defined $completion_percent && looks_like_number($completion_percent) )
      ? int($completion_percent)
      : 0;
    $percent = 0   if $percent < 0;
    $percent = 100 if $percent > 100;
    return 'Tier 1' if $percent <= 33;
    return 'Tier 2' if $percent <= 66;
    return 'Tier 3';
}

sub _normalize_progress_summary {
    my ( $self, $summary, $summary_counts, $completed, $skipped ) = @_;
    $summary        = {} unless $summary && ref $summary eq 'HASH';
    $summary_counts = {}
      unless $summary_counts && ref $summary_counts eq 'HASH';
    my $counts = {
        completed_count =>
          looks_like_number( $summary_counts->{completed_count} )
        ? int( $summary_counts->{completed_count} )
        : undef,
        skipped_count => looks_like_number( $summary_counts->{skipped_count} )
        ? int( $summary_counts->{skipped_count} )
        : undef,
        total => looks_like_number( $summary_counts->{total} )
        ? int( $summary_counts->{total} )
        : undef,
    };
    if (   !defined $counts->{completed_count}
        || !defined $counts->{skipped_count}
        || !defined $counts->{total} )
    {
        $counts =
          _summary_counts_from_payload( $self, $summary, $completed, $skipped );
    }
    for my $key (qw(completed_count skipped_count total)) {
        $counts->{$key} = 0 unless defined $counts->{$key};
        $counts->{$key} = 0 if $counts->{$key} < 0;
    }
    my $done_count =
      ( $counts->{completed_count} || 0 ) + ( $counts->{skipped_count} || 0 );
    $counts->{total} = $done_count if ( $counts->{total} || 0 ) < $done_count;

    my $module_breakdown =
      _normalize_progress_counter_hash( $summary->{module_breakdown} );
    my $modules_total =
      looks_like_number( $summary->{modules_total} )
      ? int( $summary->{modules_total} )
      : 0;
    my $modules_completed =
      looks_like_number( $summary->{modules_completed} )
      ? int( $summary->{modules_completed} )
      : 0;

    if ( ( !$modules_total || $modules_total < 0 ) && %{$module_breakdown} ) {
        $modules_total = scalar keys %{$module_breakdown};
    }
    if ( ( !$modules_completed || $modules_completed < 0 )
        && %{$module_breakdown} )
    {
        $modules_completed = 0;
        for my $module_name ( keys %{$module_breakdown} ) {
            my $entry = $module_breakdown->{$module_name} || {};
            my $done =
              ( $entry->{completed} || 0 ) + ( $entry->{skipped} || 0 );
            $modules_completed++
              if ( $entry->{total} || 0 ) > 0
              && $done >= ( $entry->{total} || 0 );
        }
    }
    $modules_total     = 0 if $modules_total < 0;
    $modules_completed = 0 if $modules_completed < 0;
    $modules_completed = $modules_total
      if $modules_total && $modules_completed > $modules_total;

    my $completion_percent = $summary->{completion_percent};
    if (   !defined $completion_percent
        || !looks_like_number($completion_percent) )
    {
        $completion_percent =
          $counts->{total}
          ? int(
            ( ( $counts->{completed_count} + $counts->{skipped_count} ) * 100 )
            / $counts->{total} )
          : 0;
    }
    $completion_percent = int($completion_percent);
    $completion_percent = 0   if $completion_percent < 0;
    $completion_percent = 100 if $completion_percent > 100;

    my $current_module = _sanitize_progress_label(
        defined $summary->{current_module}
        ? $summary->{current_module}
        : $summary->{module},
        160
    );
    my $current_tier = _sanitize_progress_label(
        defined $summary->{current_tier}
        ? $summary->{current_tier}
        : $summary->{tier},
        80
    );
    if ( $current_tier eq '' || $current_tier !~ /^Tier\s*[123]$/i ) {
        $current_tier = _completion_tier_label($completion_percent);
    }
    else {
        my $match = $current_tier =~ /([123])/;
        $current_tier =
          $match ? "Tier $1" : _completion_tier_label($completion_percent);
    }
    my $current_step_key =
      _sanitize_progress_label( $summary->{current_step_key}, 160 );
    my $current_step_title =
      _sanitize_progress_label( $summary->{current_step_title}, 240 );
    my $mastery_percentage = looks_like_number( $summary->{mastery_percentage} )
      ? int( $summary->{mastery_percentage} )
      : 0;
    $mastery_percentage = 0   if $mastery_percentage < 0;
    $mastery_percentage = 100 if $mastery_percentage > 100;
    my $assessment_score = looks_like_number( $summary->{assessment_score} )
      ? int( $summary->{assessment_score} )
      : 0;
    $assessment_score = 0   if $assessment_score < 0;
    $assessment_score = 100 if $assessment_score > 100;

    return {
        steps_total        => $counts->{total},
        steps_completed    => $counts->{completed_count},
        steps_skipped      => $counts->{skipped_count},
        completed_count    => $counts->{completed_count},
        skipped_count      => $counts->{skipped_count},
        total              => $counts->{total},
        completion_percent => $completion_percent,
        current_module     => $current_module,
        current_tier       => $current_tier,
        current_step_key   => $current_step_key,
        current_step_title => $current_step_title,
        modules_total      => $modules_total,
        modules_completed  => $modules_completed,
        module_breakdown   => $module_breakdown,
        mastery_percentage => $mastery_percentage,
        trainee_level => _sanitize_progress_label( $summary->{trainee_level}, 80 ),
        current_lesson => _sanitize_progress_label( $summary->{current_lesson}, 240 ),
        skills_mastered => _normalize_progress_label_list( $summary->{skills_mastered}, 50, 160 ),
        weak_skills => _normalize_progress_label_list( $summary->{weak_skills}, 50, 160 ),
        exercise_attempts => looks_like_number( $summary->{exercise_attempts} ) ? int( $summary->{exercise_attempts} ) : 0,
        failed_questions => looks_like_number( $summary->{failed_questions} ) ? int( $summary->{failed_questions} ) : 0,
        review_recommendations => _normalize_progress_label_list( $summary->{review_recommendations}, 50, 300 ),
        assessment_status => _sanitize_progress_label( $summary->{assessment_status}, 80 ) || 'not_started',
        assessment_score => $assessment_score,
        requires_review => _normalize_progress_label_list( $summary->{requires_review}, 50, 160 ),
        course_version => _sanitize_progress_label( $summary->{course_version}, 40 ),
        guide_version => _sanitize_progress_label( $summary->{guide_version}, 40 ),
        rules_version => _sanitize_progress_label( $summary->{rules_version}, 40 ),
        last_activity => looks_like_number( $summary->{last_activity} ) ? int( $summary->{last_activity} ) : 0
    };
}

sub guide_progress_update {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('POST');
    my ( $response, $status );
    try {
        my $identity = $self->_authenticated_user_identity();
        unless ( ( $identity->{borrowernumber} || '' ) ne ''
            || ( $identity->{userid} || '' ) ne '' )
        {
            $response =
              { ok => 0, error => 'Not authenticated staff session.' };
            $status = '401 Unauthorized';
            return;
        }
        my $read = $self->_read_json_body();
        unless ( $read->{ok} ) {
            $response =
              { ok => 0, error => $read->{error}, details => $read->{details} };
            $status = $read->{status} || '400 Bad Request';
            return;
        }
        my $payload = $read->{data} || {};
        # Koha validates csrf_token while dispatching cud-plugin_api. Repeating
        # the check here reconstructs the session from CGI state and can reject
        # a request that Koha has already authenticated (notably under Plack).
        # Still refuse legacy/non-CUD dispatch so this endpoint cannot bypass
        # Koha's native state-changing request protection.
        unless ( $self->_cud_plugin_dispatch_ok() ) {
            $response = {
                ok         => 0,
                error      => 'CSRF-protected plugin dispatch required.'
            };
            $status = '403 Forbidden';
            return;
        }
        delete $payload->{csrf_token} if $payload && ref $payload eq 'HASH';
        if ( exists $payload->{signature} && ref $payload->{signature} ) {
            $response =
              { ok => 0, error => 'Invalid signature type. Expected string.' };
            $status = '422 Unprocessable Entity';
            return;
        }
        if (   exists $payload->{completed}
            && ref $payload->{completed}
            && ref $payload->{completed} ne 'ARRAY' )
        {
            $response = {
                ok    => 0,
                error => 'Invalid completed type. Expected array of step keys.'
            };
            $status = '422 Unprocessable Entity';
            return;
        }
        if (   exists $payload->{skipped}
            && ref $payload->{skipped}
            && ref $payload->{skipped} ne 'ARRAY' )
        {
            $response = {
                ok    => 0,
                error => 'Invalid skipped type. Expected array of step keys.'
            };
            $status = '422 Unprocessable Entity';
            return;
        }
        if (   exists $payload->{summary_counts}
            && ref $payload->{summary_counts}
            && ref $payload->{summary_counts} ne 'HASH' )
        {
            $response = {
                ok    => 0,
                error => 'Invalid summary_counts type. Expected object.'
            };
            $status = '422 Unprocessable Entity';
            return;
        }
        if (   exists $payload->{training_progress}
            && ref $payload->{training_progress}
            && ref $payload->{training_progress} ne 'HASH' )
        {
            $response = {
                ok    => 0,
                error => 'Invalid training_progress type. Expected object.'
            };
            $status = '422 Unprocessable Entity';
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
        my $borrowernumber = $identity->{borrowernumber} || '';
        my $userid   = $identity->{userid} || $self->_current_user_id() || '';
        my $user_key = $borrowernumber     || $userid                   || '';
        if ( !$user_key ) {
            my $session_id = $self->_session_id();
            $user_key = $session_id ? "session:$session_id" : '';
        }
        $user_key = 'anonymous' unless $user_key;

        my $signature = $payload->{signature};
        $signature = '' unless defined $signature;
        $signature =~ s/^\s+|\s+$//g;
        my $signature_hash = $signature ne '' ? sha1_hex($signature) : '';

        my $completed =
          _normalize_progress_list( $self, $payload->{completed} );
        my $skipped = _normalize_progress_list( $self, $payload->{skipped} );

        my $summary_counts = $payload->{summary_counts};
        if ( $summary_counts && ref $summary_counts ne 'HASH' ) {
            $summary_counts = {};
        }
        if ( !$summary_counts || ref $summary_counts ne 'HASH' ) {
            my $summary = $payload->{summary};
            if ( $summary && ref $summary ne 'HASH' && !ref $summary ) {
                try {
                    $summary = from_json($summary);
                }
                catch {
                    $summary = {};
                };
            }
            $summary = {} unless $summary && ref $summary eq 'HASH';
            $summary_counts =
              _summary_counts_from_payload( $self, $summary, $completed,
                $skipped );
        }
        else {
            my $normalized = {};
            for my $key (qw(completed_count skipped_count total)) {
                my $value = $summary_counts->{$key};
                $normalized->{$key} =
                  looks_like_number($value) ? int($value) : 0;
            }
            $summary_counts = $normalized;
        }
        my $summary = $payload->{summary};
        if ( $summary && ref $summary ne 'HASH' && !ref $summary ) {
            try {
                $summary = from_json($summary);
            }
            catch {
                $summary = {};
            };
        }
        $summary = {} unless $summary && ref $summary eq 'HASH';
        $summary =
          _normalize_progress_summary( $self, $summary, $summary_counts,
            $completed, $skipped );
        $summary_counts = {
            completed_count => $summary->{completed_count} || 0,
            skipped_count   => $summary->{skipped_count}   || 0,
            total           => $summary->{total}           || 0
        };

        if (   !exists $payload->{completed}
            && !exists $payload->{skipped}
            && !exists $payload->{summary}
            && !exists $payload->{summary_counts}
            && !exists $payload->{training_progress} )
        {
            $response = { ok => 0, error => 'Missing progress data.' };
            $status   = '422 Unprocessable Entity';
            return;
        }

        my $data = {
            updated_at     => time,
            signature_hash => $signature_hash,
            completed      => $completed,
            skipped        => $skipped,
            summary_counts => $summary_counts,
            summary        => $summary,
            training_progress => _normalize_training_progress(
                $self, $payload->{training_progress}
            )
        };

        my $ok = 1;
        try {
            $ok =
              _save_guide_progress_entry( $self, $user_key, $data, $settings )
              ? 1
              : 0;
        }
        catch {
            $ok = 0;
            $self->_debug_log( $settings,
                "guide_progress_update storage error: $_" );
        };
        $response =
          $ok
          ? { ok => 1 }
          : { ok => 1, warning => 'Progress storage unavailable.' };
        $status = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation guide_progress_update error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

sub guide_progress_list {
    my ( $self, $args ) = @_;
    return $self->_json_error( '405 Method Not Allowed', 'Method not allowed' )
      unless $self->_require_method('GET');

    return $self->_json_error( '401 Unauthorized',
        'Not authenticated staff session.' )
      unless $self->_is_authenticated_staff_session();
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
        my $progress_map = _load_guide_progress_map( $self, $settings );
        $progress_map = {} unless $progress_map && ref $progress_map eq 'HASH';

        my $build_row = sub {
            my ( $userid, $name, $entry ) = @_;
            $entry = {} unless $entry && ref $entry eq 'HASH';
            my $summary_counts = $entry->{summary_counts};
            if ( !$summary_counts || ref $summary_counts ne 'HASH' ) {
                $summary_counts = _summary_counts_from_payload( $self, undef,
                    $entry->{completed}, $entry->{skipped} );
            }
            my $summary = _normalize_progress_summary( $self, $entry->{summary},
                $summary_counts, $entry->{completed}, $entry->{skipped} );
            my $updated_at =
              looks_like_number( $entry->{updated_at} )
              ? int( $entry->{updated_at} )
              : 0;
            return {
                userid         => $userid || '',
                name           => $name   || '',
                updated_at     => $updated_at,
                summary_counts => $summary_counts,
                summary        => $summary
            };
        };

        my $cgi       = $self->{'cgi'}                || CGI->new;
        my $requested = $cgi->param('borrowernumber') || '';
        if ( !$requested ) {
            my $requested_user = $cgi->param('userid') || '';
            if ($requested_user) {
                my $patron =
                  Koha::Patrons->find( { userid => $requested_user } );
                $requested =
                    $patron && $patron->borrowernumber
                  ? $patron->borrowernumber
                  : $requested_user;
            }
        }

        my @rows;
        if ($requested) {
            my $patron;
            if ( $requested =~ /^\d+$/ ) {
                $patron = Koha::Patrons->find($requested);
            }
            elsif ( $requested !~ /^session:/ ) {
                $patron = Koha::Patrons->find( { userid => $requested } );
            }
            my $userid =
              $patron
              ? ( $patron->userid || '' )
              : ( $requested =~ /^session:/ ? '' : $requested );
            my $name =
              $patron
              ? ( $patron->surname . ', ' . ( $patron->firstname || '' ) )
              : ( $requested =~ /^session:/ ? 'Session user' : '' );
            my $entry = {};
            if ( $requested ne '' && exists $progress_map->{$requested} ) {
                $entry = $progress_map->{$requested};
            }
            elsif ($patron
                && $patron->borrowernumber
                && exists $progress_map->{ $patron->borrowernumber } )
            {
                $entry = $progress_map->{ $patron->borrowernumber };
            }
            elsif ( $userid ne '' && exists $progress_map->{$userid} ) {
                $entry = $progress_map->{$userid};
            }
            push @rows, $build_row->( $userid, $name, $entry );
            $response =
              { ok => 1, users => \@rows, progress => ( $entry || {} ) };
            $status = '200 OK';
            return;
        }

        my %excluded;
        my $exclude_raw = join( ',',
            $settings->{guide_users}          || '',
            $settings->{guide_exclusion_list} || '' );
        for my $item ( split( /\s*,\s*/, $exclude_raw ) ) {
            next unless defined $item;
            $item =~ s/^\s+|\s+$//g;
            next unless $item ne '';
            $excluded{$item} = 1;
        }

        my $patrons = Koha::Patrons->search( {}, { order_by => 'userid' } );
        while ( my $patron = $patrons->next ) {
            my $userid = $patron->userid || '';
            next unless $userid;
            next if $excluded{$userid};
            my $borrowernumber = $patron->borrowernumber || '';
            my $entry          = {};
            if ( $borrowernumber ne ''
                && exists $progress_map->{$borrowernumber} )
            {
                $entry = $progress_map->{$borrowernumber};
            }
            elsif ( exists $progress_map->{$userid} ) {
                $entry = $progress_map->{$userid};
            }
            my $name = $patron->surname . ', ' . ( $patron->firstname || '' );
            push @rows, $build_row->( $userid, $name, $entry );
        }

        @rows = sort {
                 lc( $a->{userid} || '' ) cmp lc( $b->{userid} || '' )
              || lc( $a->{name}   || '' ) cmp lc( $b->{name}   || '' )
        } @rows;

        $response             = { ok => 1, users => \@rows };
        $response->{progress} = {} unless @rows;
        $status               = '200 OK';
    }
    catch {
        my $message = "$_";
        $message =~ s/\s+$//;
        warn "AutoPunctuation guide_progress_list error: $message";
        $response = {
            ok    => 0,
            error => 'Request failed. Check server logs for details.'
        };
        $status = '500 Internal Server Error';
    };
    return $self->_json_response( $status, $response );
}

1;
