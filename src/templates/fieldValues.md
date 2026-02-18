<% data.forEach(function(item) { %><%= item.prefix %>
Question: **<%= item.label %>** (`data_path`="<%= item.path %>"):
  - Answer: `<%= item.value %>`
<% }); %>