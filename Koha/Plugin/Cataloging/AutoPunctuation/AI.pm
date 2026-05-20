package Koha::Plugin::Cataloging::AutoPunctuation::AI;

use Modern::Perl;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Context;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard;

# Cache
sub _cache_backend {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_cache_backend(@_);
}

sub _cache_get {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_cache_get(@_);
}

sub _cache_set {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_cache_set(@_);
}

sub _cache_touch {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_cache_touch(
        @_);
}

sub _cache_prune {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_cache_prune(
        @_);
}

sub _rate_limit_ok {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_rate_limit_ok(@_);
}

sub _current_user_key {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_current_user_key(
        @_);
}

sub _canonical_json {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache::_canonical_json(@_);
}

# Context
sub _normalize_occurrence {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_occurrence(
        @_);
}

sub _normalize_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_tag_context(
        @_);
}

sub _normalize_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_record_context(
        @_);
}

sub _normalize_ai_features {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_ai_features(
        @_);
}

sub _normalize_ai_request_payload {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_ai_request_payload(
        @_);
}

sub _normalize_record_context_for_cache {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Context::_normalize_record_context_for_cache(
        @_);
}

# Circuit breaker
sub _circuit_key {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit::_circuit_key(@_);
}

sub _circuit_breaker_ok {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit::_circuit_breaker_ok(
        @_);
}

sub _record_failure {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit::_record_failure(
        @_);
}

sub _record_success {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit::_record_success(
        @_);
}

# Provider
sub _ai_key_available {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_ai_key_available(
        @_);
}

sub _selected_model {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_selected_model(
        @_);
}

sub _call_ai_provider {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_call_ai_provider(
        @_);
}

sub _sanitize_ai_response_for_chat {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_sanitize_ai_response_for_chat(
        @_);
}

sub _append_truncation_warning {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_append_truncation_warning(
        @_);
}

# Parse
sub _build_degraded_ai_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_build_degraded_ai_response(
        @_);
}

sub _build_unstructured_ai_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_build_unstructured_ai_response(
        @_);
}

sub _augment_cataloging_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_augment_cataloging_response(
        @_);
}

sub _extract_classification_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_extract_classification_from_text(
        @_);
}

sub _extract_subject_headings_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_extract_subject_headings_from_text(
        @_);
}

sub _extract_cataloging_suggestions_from_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_extract_cataloging_suggestions_from_text(
        @_);
}

sub _parse_lc_target {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_parse_lc_target(
        @_);
}

sub _normalize_lc_text {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_normalize_lc_text(
        @_);
}

sub _format_lc_call_number {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_format_lc_call_number(
        @_);
}

sub _rank_lc_candidates {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_rank_lc_candidates(
        @_);
}

sub _extract_lc_call_numbers {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse::_extract_lc_call_numbers(
        @_);
}

# Prompt
sub _is_cataloging_ai_request {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_is_cataloging_ai_request(
        @_);
}

sub _cataloging_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_cataloging_tag_context(
        @_);
}

sub _cataloging_tag_context_from_payload {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_cataloging_tag_context_from_payload(
        @_);
}

sub _cataloging_source_from_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_cataloging_source_from_tag_context(
        @_);
}

sub _build_cataloging_error_response {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_build_cataloging_error_response(
        @_);
}

sub _build_ai_prompt {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_build_ai_prompt(
        @_);
}

sub _build_ai_prompt_punctuation {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_build_ai_prompt_punctuation(
        @_);
}

sub _build_ai_prompt_cataloging {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_build_ai_prompt_cataloging(
        @_);
}

# Guard
sub _validate_ai_response_guardrails {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard::_validate_ai_response_guardrails(
        @_);
}

sub _redact_tag_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard::_redact_tag_context(
        @_);
}

sub _redact_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard::_redact_record_context(
        @_);
}

sub _filter_record_context {
    return
      Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard::_filter_record_context(
        @_);
}

sub _redact_value {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard::_redact_value(
        @_);
}

1;
