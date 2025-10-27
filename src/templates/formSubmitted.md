# Form Submitted Successfully! ✅

**Form**: <%= form.title %>
**Submission ID** (for internal and future lookup use only): <%= submissionId %>
**Submitted Fields**: <%= submittedFieldsCount %>

<%= dataSummary %>

**Nested Form Data Structure**:
```json
<%= JSON.stringify(data, null, 2) %>
```
