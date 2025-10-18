No submission found ending with "<%= partialId %>" for search "<%= searchQuery %>" in <%= form.title %>.

**Available submissions:**
<% availableSubmissions.forEach(function(submission, index) { %>
**Submission <%= index + 1 %>** (ID ends with: **<%= submission.partialId %>**)
<% submission.data.forEach(function(item) { %>
- **<%= item.label %>:** <%= item.value %>
<% }); %>
---
<% }); %>

Please try again with one of the partial IDs shown above, or be more specific in your search query.