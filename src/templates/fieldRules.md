### Field Rules
The following rules should apply to establish the value for every field (**Type**) within this form.
<% rules.forEach(function([type, rule]) { %>
  - **<%= type %>**: <%= rule %>
<% }) %>