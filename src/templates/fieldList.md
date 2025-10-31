<% fields.forEach(function(field) { %>
- **<%= field.label %>**
  - data_path: "<%= field.path %>"
  - field_type: <%= field.type %><% if (field.description) { %>
  - Description: <%= field.description %><% } %><% }); %>