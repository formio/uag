## Collected Data
IMPORTANT: When presenting the values to the user, it must appear exactly as it will be submitted; e.g "user@example.com", "(555) 123-4560"

<% data.forEach(function(item) { %><%= item.prefix %>- **<%= item.label %>**: <%= item.value %>
<% }); %>