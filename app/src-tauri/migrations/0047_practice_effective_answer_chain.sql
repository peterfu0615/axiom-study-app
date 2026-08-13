-- A manual grade override may not carry a new answer. Keep the latest
-- non-null corrected answer from the revision chain instead of falling back
-- to the immutable original response.
DROP VIEW practice_effective_responses;

CREATE VIEW practice_effective_responses AS
SELECT response.id AS response_id,
  response.practice_attempt_id,
  response.practice_item_id,
  response.extracted_answer_json,
  response.corrected_answer_json,
  response.grading_result_json,
  response.status,
  latest.id AS latest_revision_id,
  latest.revision_index AS latest_revision_index,
  COALESCE(
    (SELECT revision.corrected_answer_json
      FROM practice_grading_revisions revision
      WHERE revision.practice_response_id=response.id
        AND revision.corrected_answer_json IS NOT NULL
      ORDER BY revision.revision_index DESC LIMIT 1),
    response.corrected_answer_json,
    response.extracted_answer_json
  ) AS effective_answer_json,
  COALESCE(latest.new_grading_json, response.grading_result_json) AS effective_grading_json
FROM practice_responses response
LEFT JOIN practice_grading_revisions latest
  ON latest.practice_response_id = response.id
 AND NOT EXISTS (
   SELECT 1 FROM practice_grading_revisions newer
   WHERE newer.practice_response_id = latest.practice_response_id
     AND newer.revision_index > latest.revision_index
 );
