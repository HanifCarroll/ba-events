-- Migration: Add needs attention breakdown function
--
-- Returns counts for different categories of events needing attention:
-- - ready_for_enrichment: pending status, has link, missing desc or venue
-- - missing_venue_only: completed enrichment but still missing venue
-- - enrichment_failed: previous enrichment attempts failed
-- - no_link: missing data but no link to enrich from

CREATE OR REPLACE FUNCTION get_needs_attention_breakdown()
RETURNS TABLE (
  ready_for_enrichment bigint,
  missing_venue_only bigint,
  enrichment_failed bigint,
  no_link bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- Ready for enrichment: pending status, has link, missing desc or venue
    COUNT(*) FILTER (WHERE
      enrichment_status = 'pending'
      AND link IS NOT NULL
      AND (description_es IS NULL OR venue_id IS NULL)
    ) as ready_for_enrichment,

    -- Missing venue only: completed but missing venue, has link
    COUNT(*) FILTER (WHERE
      enrichment_status = 'completed'
      AND venue_id IS NULL
      AND link IS NOT NULL
    ) as missing_venue_only,

    -- Enrichment failed: previous errors
    COUNT(*) FILTER (WHERE
      enrichment_status = 'failed'
    ) as enrichment_failed,

    -- No link: missing data but can't auto-enrich
    COUNT(*) FILTER (WHERE
      link IS NULL
      AND (description_es IS NULL OR venue_id IS NULL)
    ) as no_link
  FROM events
  WHERE status != 'past'::event_status
$$;

COMMENT ON FUNCTION get_needs_attention_breakdown() IS
'Returns breakdown of events needing attention by category:
- ready_for_enrichment: Can be auto-enriched (pending + has link)
- missing_venue_only: Has description but needs venue extraction
- enrichment_failed: Previous enrichment failed, can retry
- no_link: Cannot be auto-enriched, needs manual entry';
