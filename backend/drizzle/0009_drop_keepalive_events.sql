-- Keep-alive re-asserts are no longer logged; remove the rows already written.
DELETE FROM `fan_events` WHERE `kind` = 'command' AND json_extract(`payload`, '$.keepAlive') = 1;
