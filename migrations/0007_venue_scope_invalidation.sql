ALTER TABLE events ADD COLUMN scope_invalidated_at TEXT;

-- Scope changes must not advance events.updated_at: intake uses that as a revision check.
CREATE TRIGGER events_track_scope_invalidation AFTER UPDATE OF scope ON events
WHEN OLD.scope IS NOT NULL AND NEW.scope IS NULL
BEGIN
  UPDATE events SET scope_invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

DROP TRIGGER venues_invalidate_event_scope;
CREATE TRIGGER venues_invalidate_event_scope AFTER UPDATE OF name, neighborhood ON venues
WHEN NEW.neighborhood IS NOT OLD.neighborhood OR (NEW.name IS NOT OLD.name AND (
  -- Mirror venueNameKey (src/features/import/core/venue-identity.ts) for the venue alphabet.
  -- SQLite has no Unicode normalization or regexp replacement. Fold the catalog accents (also in decomposed form)
  -- before removing trailing locality qualifiers, then collapse any punctuation and whitespace to word separators.
  WITH RECURSIVE
  alphabet(as_written, folded) AS (VALUES (
    'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ–—KÅ',
    'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy--ka'
  )),
  accents(base, marks) AS (VALUES
    ('a', char(768,769,770,771,776,778)), ('e', char(768,769,770,776)), ('i', char(768,769,770,776)),
    ('o', char(768,769,770,771,776)), ('u', char(768,769,770,776)), ('n', char(771)), ('c', char(807)), ('y', char(769,776))
  ),
  folding(side, rest, value) AS (
    VALUES (0, OLD.name, ''), (1, NEW.name, '')
    UNION ALL
    SELECT side, substr(rest, CASE WHEN substr(rest, 2, 1) <> '' AND instr(marks, substr(rest, 2, 1)) > 0 THEN 3 ELSE 2 END),
      value || CASE WHEN substr(rest, 1, 2) = 'Y' || char(776) THEN ' ' -- NFC composes to Ÿ, outside the fold alphabet.
        WHEN substr(rest, 1, 1) = 'İ' THEN 'i '
        WHEN substr(rest, 1, 1) GLOB '[A-Za-z0-9-]' THEN lower(substr(rest, 1, 1))
        ELSE coalesce(nullif(substr(folded, instr(as_written, substr(rest, 1, 1)), 1), ''), ' ') END
    FROM folding CROSS JOIN alphabet LEFT JOIN accents ON base = lower(substr(rest, 1, 1))
    WHERE rest <> ''
  ),
  spaced(side, value) AS (
    SELECT side, value FROM folding WHERE rest = ''
    UNION ALL
    SELECT side, replace(value, '  ', ' ') FROM spaced WHERE instr(value, '  ') > 0
  ),
  localities(word) AS (VALUES ('buenos aires'), ('caba'), ('argentina')),
  stripped(side, value, depth) AS (
    SELECT side, rtrim(value, ' -'), 0 FROM spaced WHERE instr(value, '  ') = 0
    UNION ALL
    SELECT side, rtrim(substr(value, 1, length(value) - length(word) -
      CASE WHEN substr(value, -length(word) - 1, 1) = ' ' THEN 2 ELSE 1 END)), depth + 1
    FROM stripped CROSS JOIN localities
    WHERE substr(value, -length(word)) = word AND rtrim(substr(value, 1, length(value) - length(word))) LIKE '%-'
  ),
  keys(side, value) AS (
    SELECT side, replace(value, '-', ' ') FROM (SELECT side, value, max(depth) FROM stripped GROUP BY side)
    UNION ALL
    SELECT side, replace(value, '  ', ' ') FROM keys WHERE instr(value, '  ') > 0
  )
  SELECT count(DISTINCT trim(value)) = 2 FROM keys WHERE instr(value, '  ') = 0
))
BEGIN
  UPDATE events SET scope = NULL, scope_reason = NULL, scope_judged_at = NULL, scope_version = NULL
  WHERE venue_id = NEW.id AND scope IS NOT NULL;
END;
