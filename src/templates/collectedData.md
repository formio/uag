## Collected Data
Here is the data collected so far:

<% data.forEach(function(item) { %><%= item.prefix %>- **<%= item.label %>** (`data_path`: "<%= item.path %>"): <%= item.value %>
<% }); %>