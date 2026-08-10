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

package Koha::Plugin::Cataloging::AutoPunctuation::AI;

use Modern::Perl;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Cache;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Context;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Circuit;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Parse;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Guard;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract;
use Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS;

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

sub _model_capabilities {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::_model_capabilities(@_);
}

sub _generate_ai {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Provider::generate(@_);
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

sub _ai_system_policy {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Prompt::_ai_system_policy(@_);
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

# Versioned task contracts
sub _supported_ai_tasks {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_supported_ai_tasks(@_);
}

sub _ai_task_schema_file {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_ai_task_schema_file(@_);
}

sub _ai_task_schema {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_ai_task_schema(@_);
}

sub _validate_ai_task_response {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_validate_ai_task_response(@_);
}

sub _normalize_ai_task_response {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::Contract::_normalize_ai_task_response(@_);
}

# Published Library of Congress Classification schedule evidence
sub _verify_lccs_result {
    return Koha::Plugin::Cataloging::AutoPunctuation::AI::LCCS::_verify_lccs_result(@_);
}

1;
