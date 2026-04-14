UPDATE incidents
SET status = 'remediation_pending'
WHERE status = 'open'
  AND id IN (
    SELECT incident_id
    FROM remediation_runs
    WHERE status = 'succeeded'
  );
