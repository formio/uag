# Form Submitted Successfully! ✅

**Form**: <%= form.title %><% if (submissionId) { %>
**Submission ID** (for internal and future lookup use only): <%= submissionId %><% } %>
**Submitted Fields**: <%= submittedFieldsCount %>

<%= dataSummary %>