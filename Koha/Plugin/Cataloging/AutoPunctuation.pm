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

package Koha::Plugin::Cataloging::AutoPunctuation;

use Modern::Perl;
use base qw(Koha::Plugins::Base);
use C4::Auth;
use C4::Context;
use Koha::DateUtils;
use Koha::Patrons;
use Koha::Token;
use CGI;
use JSON qw(to_json from_json);
use Try::Tiny;
use File::Basename;
use Digest::SHA qw(sha256_hex sha256 sha1_hex);
use Koha::Plugin::Cataloging::AutoPunctuation::UI;
use Koha::Plugin::Cataloging::AutoPunctuation::Settings;
use Koha::Plugin::Cataloging::AutoPunctuation::Security;
use Koha::Plugin::Cataloging::AutoPunctuation::Updates;
use Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress;
use Koha::Plugin::Cataloging::AutoPunctuation::Rules;
use Koha::Plugin::Cataloging::AutoPunctuation::Schema;
use Koha::Plugin::Cataloging::AutoPunctuation::Http;
use Koha::Plugin::Cataloging::AutoPunctuation::Api;
use Koha::Plugin::Cataloging::AutoPunctuation::AI;

our $VERSION         = "1.0.0";
our $PLUGIN_REPO_URL = "https://github.com/build-with-duke/Koha_ISBD_Assistant_Plugin/";
our $PLUGIN_RELEASES_API =
"https://api.github.com/repos/build-with-duke/Koha_ISBD_Assistant_Plugin/releases/latest";
our $AUTHOR_LINKEDIN   = "https://linkedin.com/in/duke-j-a1a9b0260";
our $AI_PROMPT_VERSION = "1.0.1";

our $metadata = {
    name            => 'Koha_ISBD_Cataloging_Assistant',
    author          => 'Duke Chijimaka Jonathan',
    date_authored   => '2025-06-02',
    date_updated    => '2026-05-07',
    minimum_version => '25.11',
    maximum_version => undef,
    version         => $VERSION,
    description     =>
'ISBD cataloging assistant plugin for Koha with MARC21 guardrails, training guide, and optional AI guidance. Compatible with MARC21 workflows used in AACR2, RDA, and other cataloguing standards.',
    license => 'GPL-3.0',
};

sub new {
    my ( $class, $args ) = @_;
    $args->{'metadata'} = $metadata;
    $args->{'metadata'}->{'class'} = $class;
    $args->{'cgi'} ||= CGI->new;
    return $class->SUPER::new($args);
}

# ─── Koha plugin entry points ────────────────────────────────────────

sub tool { return Koha::Plugin::Cataloging::AutoPunctuation::UI::tool(@_); }

sub configure {
    return Koha::Plugin::Cataloging::AutoPunctuation::UI::configure(@_);
}

sub intranet_js {
    return Koha::Plugin::Cataloging::AutoPunctuation::UI::intranet_js(@_);
}
sub uninstall { return 1; }

# ─── Plugin API entry points (called by run.pl) ──────────────────────

sub validate_field {
    return Koha::Plugin::Cataloging::AutoPunctuation::Api::validate_field(@_);
}

sub validate_record {
    return Koha::Plugin::Cataloging::AutoPunctuation::Api::validate_record(@_);
}

sub ai_suggest {
    return Koha::Plugin::Cataloging::AutoPunctuation::Api::ai_suggest(@_);
}

sub test_connection {
    return Koha::Plugin::Cataloging::AutoPunctuation::Api::test_connection(@_);
}

sub api_classify {
    my ($self) = @_;
    return $self->_json_error( '410 Gone',
        'Deprecated endpoint. Use ai_suggest instead.' );
}

sub ai_models {
    my ( $self, @rest ) = @_;
    my $result;
    my $ok = eval {
        $result =
          Koha::Plugin::Cataloging::AutoPunctuation::Api::ai_models( $self,
            @rest );
        1;
    };
    return $result if $ok;
    warn "AutoPunctuation ai_models dispatch error: $@";
    return $self->_json_response(
        '500 Internal Server Error',
        {
            ok    => 0,
            error => 'Model list request failed. Check server logs for details.'
        }
    );
}

sub guide_progress_update {
    my ( $self, @rest ) = @_;
    my $result;
    my $ok = eval {
        $result =
          Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::guide_progress_update(
            $self, @rest );
        1;
    };
    return $result if $ok;
    warn "AutoPunctuation guide_progress_update dispatch error: $@";
    return $self->_json_response(
        '500 Internal Server Error',
        {
            ok    => 0,
            error =>
              'Guide progress update failed. Check server logs for details.'
        }
    );
}

sub guide_progress_list {
    my ( $self, @rest ) = @_;
    my $result;
    my $ok = eval {
        $result =
          Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::guide_progress_list(
            $self, @rest );
        1;
    };
    return $result if $ok;
    warn "AutoPunctuation guide_progress_list dispatch error: $@";
    return $self->_json_response(
        '500 Internal Server Error',
        {
            ok    => 0,
            error =>
              'Guide progress list failed. Check server logs for details.'
        }
    );
}

# ─── Filesystem helpers ──────────────────────────────────────────────

sub get_plugin_dir {
    my ($self) = @_;
    my $class_path = ref($self) || $self;
    $class_path =~ s{::}{/}g;
    return C4::Context->config('pluginsdir') . '/' . $class_path;
}

sub _read_file {
    my ( $self, $relative_path ) = @_;
    my $file_path = $self->get_plugin_dir() . '/' . $relative_path;
    open my $fh, '<:encoding(UTF-8)', $file_path or return undef;
    local $/;
    my $content = <$fh>;
    close $fh;
    return $content;
}

# ─── Cross-module pass-through methods ───────────────────────────────
# These use fully qualified package names because Perl's method resolution
# on $self only searches the class hierarchy, not imported namespaces.

# Settings
sub _default_settings {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_default_settings(
        @_);
}

sub _load_settings {
    return Koha::Plugin::Cataloging::AutoPunctuation::Settings::_load_settings(
        @_);
}

sub _debug_log {
    return Koha::Plugin::Cataloging::AutoPunctuation::Settings::_debug_log(@_);
}

sub _safe_retrieve_data {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_safe_retrieve_data(
        @_);
}

sub _safe_store_data {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_safe_store_data(@_);
}

sub _load_model_cache {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_load_model_cache(
        @_);
}

sub _save_model_cache {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_save_model_cache(
        @_);
}

sub _resolve_ai_max_output_tokens {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Settings::_resolve_ai_max_output_tokens(
        @_);
}

# Security
sub _csrf_ok {
    return Koha::Plugin::Cataloging::AutoPunctuation::Security::_csrf_ok(@_);
}

sub _csrf_debug_info {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_csrf_debug_info(@_);
}

sub _csrf_identity_id {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_csrf_identity_id(
        @_);
}

sub _session_id {
    return Koha::Plugin::Cataloging::AutoPunctuation::Security::_session_id(@_);
}

sub _is_authenticated_staff_session {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_is_authenticated_staff_session(
        @_);
}

sub _authenticated_user_identity {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_authenticated_user_identity(
        @_);
}

sub _secret_present {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_secret_present(@_);
}

sub _secret_is_encrypted {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_secret_is_encrypted(
        @_);
}

sub _encryption_secret {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_encryption_secret(
        @_);
}

sub _encryption_error_message {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_encryption_error_message(
        @_);
}

sub _encrypt_secret {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_encrypt_secret(@_);
}

sub _decrypt_secret {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_decrypt_secret(@_);
}

sub _migrate_secret {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_migrate_secret(@_);
}

sub _obfuscate_secret {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_obfuscate_secret(
        @_);
}

sub _plugin_csrf_token {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Security::_plugin_csrf_token(
        @_);
}

# Http
sub _json_response {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_json_response(@_);
}

sub _json_error {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_json_error(@_);
}

sub _require_method {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_require_method(@_);
}

sub _read_json_payload {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_read_json_payload(
        @_);
}

sub _read_json_body {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_read_json_body(@_);
}

sub _current_user_id {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_current_user_id(
        @_);
}

sub _emit_json {
    return Koha::Plugin::Cataloging::AutoPunctuation::Http::_emit_json(@_);
}

# GuideProgress
sub _guide_progress_key {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_guide_progress_key(
        @_);
}

sub _load_guide_progress_index {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_load_guide_progress_index(
        @_);
}

sub _save_guide_progress_index {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_save_guide_progress_index(
        @_);
}

sub _load_guide_progress_map {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_load_guide_progress_map(
        @_);
}

sub _save_guide_progress_map {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_save_guide_progress_map(
        @_);
}

sub _load_guide_progress_entry {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_load_guide_progress_entry(
        @_);
}

sub _save_guide_progress_entry {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_save_guide_progress_entry(
        @_);
}

sub _normalize_progress_list {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_normalize_progress_list(
        @_);
}

sub _summary_counts_from_payload {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_summary_counts_from_payload(
        @_);
}

sub _normalize_progress_summary {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_normalize_progress_summary(
        @_);
}

# Rules
sub _merge_rules_pack {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_merge_rules_pack(
        @_);
}

sub _load_rules_pack {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_load_rules_pack(
        @_);
}

sub _validate_custom_rules {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_validate_custom_rules(
        @_);
}

sub _validate_field_with_rules {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_validate_field_with_rules(
        @_);
}

sub _validate_record_with_rules {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_validate_record_with_rules(
        @_);
}

sub _build_coverage_report {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_build_coverage_report(
        @_);
}

sub _is_excluded_field {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_is_excluded_field(@_);
}

sub _is_field_covered {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_is_field_covered(
        @_);
}

sub _strip_punct_space {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_strip_punct_space(@_);
}

sub _punctuation_only_change {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_punctuation_only_change(
        @_);
}

sub _normalize_punctuation {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_normalize_punctuation(
        @_);
}

sub _resolve_suffix {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_resolve_suffix(
        @_);
}

sub _value_ends_with_any {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_value_ends_with_any(
        @_);
}

sub _strip_endings {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_strip_endings(@_);
}

sub _expected_value_for_check {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Rules::_expected_value_for_check(
        @_);
}

sub _apply_case_mode {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_apply_case_mode(
        @_);
}

sub _initial_upper {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_initial_upper(@_);
}

sub _title_case {
    return Koha::Plugin::Cataloging::AutoPunctuation::Rules::_title_case(@_);
}

# Schema
sub _load_schema {
    return Koha::Plugin::Cataloging::AutoPunctuation::Schema::_load_schema(@_);
}

sub _validate_schema {
    return Koha::Plugin::Cataloging::AutoPunctuation::Schema::_validate_schema(
        @_);
}

# Updates
sub _check_for_updates {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Updates::_check_for_updates(
        @_);
}

sub _fetch_openrouter_models {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Updates::_fetch_openrouter_models(
        @_);
}

sub _fetch_openai_models {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::Updates::_fetch_openai_models(
        @_);
}

# AI::Cache
sub _cache_backend {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_backend(@_);
}

sub _cache_get {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_get(@_);
}

sub _cache_set {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_set(@_);
}

sub _cache_key {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_key(@_);
}

sub _cache_get_backend {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_get_backend(
        @_);
}

sub _cache_set_backend {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_set_backend(
        @_);
}

sub _cache_touch {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_touch(@_);
}

sub _cache_prune {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_cache_prune(@_);
}

sub _rate_limit_ok {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_rate_limit_ok(@_);
}

sub _current_user_key {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_current_user_key(@_);
}

sub _canonical_json {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_canonical_json(@_);
}

# AI::Context
sub _normalize_occurrence {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_occurrence(@_);
}

sub _normalize_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_tag_context(@_);
}

sub _normalize_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_record_context(
        @_);
}

sub _normalize_ai_features {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_ai_features(@_);
}

sub _normalize_ai_request_payload {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_ai_request_payload(
        @_);
}

sub _normalize_record_context_for_cache {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_record_context_for_cache(
        @_);
}

# AI::Circuit
sub _circuit_key {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_circuit_key(@_);
}

sub _circuit_breaker_ok {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_circuit_breaker_ok(
        @_);
}

sub _record_failure {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_record_failure(@_);
}

sub _record_success {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_record_success(@_);
}

# AI::Provider
sub _ai_key_available {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_ai_key_available(@_);
}

sub _selected_model {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_selected_model(@_);
}

sub _call_ai_provider {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_call_ai_provider(@_);
}

sub _sanitize_ai_response_for_chat {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_sanitize_ai_response_for_chat(
        @_);
}

sub _append_truncation_warning {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_append_truncation_warning(
        @_);
}

# AI::Parse
sub _build_degraded_ai_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_degraded_ai_response(
        @_);
}

sub _build_unstructured_ai_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_unstructured_ai_response(
        @_);
}

sub _augment_cataloging_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_augment_cataloging_response(
        @_);
}

sub _extract_classification_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_extract_classification_from_text(
        @_);
}

sub _extract_subject_headings_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_extract_subject_headings_from_text(
        @_);
}

sub _extract_cataloging_suggestions_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_extract_cataloging_suggestions_from_text(
        @_);
}

sub _parse_lc_target {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_parse_lc_target(@_);
}

sub _normalize_lc_text {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_normalize_lc_text(
        @_);
}

sub _format_lc_call_number {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_format_lc_call_number(@_);
}

sub _rank_lc_candidates {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_rank_lc_candidates(
        @_);
}

sub _extract_lc_call_numbers {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_extract_lc_call_numbers(
        @_);
}

sub _summarize_ai_findings {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_summarize_ai_findings(@_);
}

sub _confidence_percent_from_findings {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_confidence_percent_from_findings(
        @_);
}

# AI::Prompt
sub _is_cataloging_ai_request {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_is_cataloging_ai_request(
        @_);
}

sub _cataloging_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_cataloging_tag_context(
        @_);
}

sub _cataloging_tag_context_from_payload {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_cataloging_tag_context_from_payload(
        @_);
}

sub _cataloging_source_from_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_cataloging_source_from_tag_context(
        @_);
}

sub _build_cataloging_error_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_cataloging_error_response(
        @_);
}

sub _build_ai_prompt {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_ai_prompt(@_);
}

sub _build_ai_prompt_punctuation {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_ai_prompt_punctuation(
        @_);
}

sub _build_ai_prompt_cataloging {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_build_ai_prompt_cataloging(
        @_);
}

# AI::Guard
sub _validate_ai_response_guardrails {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_validate_ai_response_guardrails(
        @_);
}

sub _redact_tag_context {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_redact_tag_context(
        @_);
}

sub _redact_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_redact_record_context(@_);
}

sub _filter_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::_filter_record_context(@_);
}

sub _redact_value {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::_redact_value(@_);
}

1;
