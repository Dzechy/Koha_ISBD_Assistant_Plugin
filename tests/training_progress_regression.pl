use Modern::Perl;
use Test::More;
use FindBin qw($Bin);
use File::Spec;

BEGIN {
    package C4::Context;
    $INC{'C4/Context.pm'} = 1;
    package Koha::Patrons;
    $INC{'Koha/Patrons.pm'} = 1;
}

use lib File::Spec->catdir( $Bin, '..' );
use Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress;

my $progress = {
    engine_version  => '1.0.0',
    course_version  => '3.0.0',
    guide_version   => '3.0.0',
    rules_version   => '1.0.0',
    onboarding      => { completed => 1, experience => 'basic_marc' },
    current_module  => 'title-responsibility',
    current_lesson  => 'title-relationship-lab',
    exercise_attempts => {
        'title-fix-245' => [
            { at => 10, correct => 0, score => 0, hints_used => 1 },
            { at => 20, correct => 1, score => 1, hints_used => 0 }
        ]
    },
    skill_mastery => {
        'semantic-relationships' => { status => 'practicing', score => 50 }
    },
    mistakes => { 'terminal-punctuation' => 3 },
    advanced_mode => 0,
    untrusted_extra => 'discard me'
};

my $normalized =
  Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_normalize_training_progress(
    undef, $progress );
is( $normalized->{course_version}, '3.0.0', 'course version persists' );
is( $normalized->{onboarding}{experience}, 'basic_marc',
    'onboarding experience persists' );
is( scalar @{ $normalized->{exercise_attempts}{'title-fix-245'} }, 2,
    'exercise attempts persist' );
ok( !exists $normalized->{untrusted_extra},
    'unknown top-level training data is discarded' );

my $summary =
  Koha::Plugin::Cataloging::AutoPunctuation::GuideProgress::_normalize_progress_summary(
    undef,
    {
        completion_percent    => 74,
        mastery_percentage   => 81,
        current_module       => 'Title & Responsibility',
        current_lesson       => '245 relationship lab',
        trainee_level        => 'some_experience',
        weak_skills          => [ '264 indicators', 'abbreviation punctuation' ],
        skills_mastered      => ['MARC structure'],
        exercise_attempts    => 18,
        failed_questions     => 3,
        review_recommendations => ['Review terminal punctuation'],
        assessment_status    => 'not_started',
        assessment_score     => 0,
        requires_review      => ['publication'],
        course_version       => '3.0.0',
        guide_version        => '3.0.0',
        rules_version        => '1.0.0',
        last_activity        => 12345
    },
    { completed_count => 8, skipped_count => 0, total => 11 },
    [], []
  );

is( $summary->{mastery_percentage}, 81, 'mastery remains separate from completion' );
is( $summary->{current_lesson}, '245 relationship lab',
    'supervisor summary includes current lesson' );
is_deeply( $summary->{weak_skills},
    [ '264 indicators', 'abbreviation punctuation' ],
    'weak skills are retained for supervisors' );
is( $summary->{exercise_attempts}, 18, 'attempt count is retained' );
is( $summary->{failed_questions}, 3, 'failed question count is retained' );
is_deeply( $summary->{requires_review}, ['publication'],
    'version review state is retained' );

done_testing();
