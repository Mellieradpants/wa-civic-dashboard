const GOVERNANCE_STATUSES = {
  MATCH: "match",
  MISMATCH_DETECTED: "mismatch_detected",
  CONTRADICTION_DETECTED: "contradiction_detected",
  MISSING_REQUIRED_SOURCE: "missing_required_source",
  NEEDS_REVIEW: "needs_review",
  UNSUPPORTED_DOWNSTREAM_ACTION: "unsupported_downstream_action",
};

const REQUIRED_ANCHOR_FIELDS = [
  "fieldName",
  "extractedValue",
  "sourceAnchor",
  "sourceSystem",
  "documentType",
];

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function checkRequiredAnchorFields(record) {
  const missingFields = REQUIRED_ANCHOR_FIELDS.filter((field) => !hasValue(record[field]));

  if (!missingFields.length) {
    return {
      status: GOVERNANCE_STATUSES.MATCH,
      issue: null,
      missingFields: [],
    };
  }

  return {
    status: GOVERNANCE_STATUSES.MISSING_REQUIRED_SOURCE,
    issue: "Record is missing one or more required source anchor fields.",
    missingFields,
  };
}

function checkFieldConflict(record, comparisonRecord) {
  if (!comparisonRecord) {
    return {
      status: GOVERNANCE_STATUSES.MATCH,
      issue: null,
    };
  }

  const sameField = record.fieldName === comparisonRecord.fieldName;
  const bothHaveValues = hasValue(record.extractedValue) && hasValue(comparisonRecord.extractedValue);
  const valuesDiffer = String(record.extractedValue).trim() !== String(comparisonRecord.extractedValue).trim();

  if (sameField && bothHaveValues && valuesDiffer) {
    return {
      status: GOVERNANCE_STATUSES.CONTRADICTION_DETECTED,
      issue: "Two source-anchored records contain conflicting values for the same field.",
      comparedField: record.fieldName,
      firstValue: record.extractedValue,
      secondValue: comparisonRecord.extractedValue,
    };
  }

  return {
    status: GOVERNANCE_STATUSES.MATCH,
    issue: null,
  };
}

function checkDownstreamActionSupport(record, requestedAction) {
  if (!requestedAction) {
    return {
      status: GOVERNANCE_STATUSES.MATCH,
      issue: null,
    };
  }

  const anchorCheck = checkRequiredAnchorFields(record);

  if (anchorCheck.status !== GOVERNANCE_STATUSES.MATCH) {
    return {
      status: GOVERNANCE_STATUSES.UNSUPPORTED_DOWNSTREAM_ACTION,
      issue: "Requested downstream action is blocked because required source support is missing.",
      requestedAction,
      blockingStatus: anchorCheck.status,
      missingFields: anchorCheck.missingFields,
    };
  }

  return {
    status: GOVERNANCE_STATUSES.MATCH,
    issue: null,
    requestedAction,
  };
}

function evaluateGovernanceRecord({ record, comparisonRecord = null, requestedAction = null }) {
  const checks = [
    checkRequiredAnchorFields(record),
    checkFieldConflict(record, comparisonRecord),
    checkDownstreamActionSupport(record, requestedAction),
  ];

  const activeIssues = checks.filter((check) => check.status !== GOVERNANCE_STATUSES.MATCH);

  return {
    inputField: record.fieldName || null,
    extractedValue: record.extractedValue || null,
    sourceAnchor: record.sourceAnchor || null,
    sourceSystem: record.sourceSystem || null,
    documentType: record.documentType || null,
    overallStatus: activeIssues.length ? GOVERNANCE_STATUSES.NEEDS_REVIEW : GOVERNANCE_STATUSES.MATCH,
    checks,
    activeIssues,
    principle: "Detect mismatch or missing support without deciding truth or inferring missing values.",
  };
}

const sampleMissingSource = evaluateGovernanceRecord({
  record: {
    fieldName: "legal_last_name",
    extractedValue: "AssumedName",
    sourceAnchor: "",
    sourceSystem: "uploaded_document",
    documentType: "benefits_record",
  },
  requestedAction: "propagate_identity_field",
});

const sampleConflict = evaluateGovernanceRecord({
  record: {
    fieldName: "marriage_date",
    extractedValue: "2024-03-01",
    sourceAnchor: "marriage certificate line 4",
    sourceSystem: "uploaded_document",
    documentType: "marriage_certificate",
  },
  comparisonRecord: {
    fieldName: "marriage_date",
    extractedValue: "2022-05-14",
    sourceAnchor: "prior benefits record field 12",
    sourceSystem: "agency_record",
    documentType: "benefits_record",
  },
});

export {
  GOVERNANCE_STATUSES,
  REQUIRED_ANCHOR_FIELDS,
  checkRequiredAnchorFields,
  checkFieldConflict,
  checkDownstreamActionSupport,
  evaluateGovernanceRecord,
  sampleMissingSource,
  sampleConflict,
};
