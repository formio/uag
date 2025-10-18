Multiple submissions found ending with "<%= partialId %>" - the partial ID is not unique enough.

**Matching submissions:**
<% matchingSubmissions.forEach(function(submission, index) { %>
**Submission <%= index + 1 %>** (Full ID: <%= submission.fullId %>)
<% submission.data.forEach(function(item) { %>
- **<%= item.label %>:** <%= item.value %>
<% }); %>
---
<% }); %>

Please use a longer portion of the submission ID to uniquely identify which record you want to update.