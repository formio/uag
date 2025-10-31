**Field Type Rules**
The following rules should be used for the value of every field type (field_type) within this form.
<% rules.forEach(function([type, rule]) { %>
  - **<%= type %>**: <%= rule %><% }) %>