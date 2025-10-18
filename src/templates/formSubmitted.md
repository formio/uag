# Form Submitted Successfully! ✅

**Form**: <%= form.title %>
**Submission ID**: <%= submissionId %>
**Submitted Fields**: <%= submittedFieldsCount %>

<%= dataSummary %>

**Nested Form Data Structure**:
```json
<%= JSON.stringify(data, null, 2) %>
```
