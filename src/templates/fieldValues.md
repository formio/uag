<% data.forEach(function(item) { %><%= item.prefix %>
Question: **<%= item.label %>**:
  - Answer: `<%= item.value %>`
<% }); %>