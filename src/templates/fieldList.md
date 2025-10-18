<% fields.forEach(function(field) { %>
- **<%= field.label %>** (\`<%= field.path %>\`) - <%= field.type %>
<% }); %>