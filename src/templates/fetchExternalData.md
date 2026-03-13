<% if (options) { %>Here are the available select options for **<%= label %>** (`data_path`: "<%= dataPath %>"):

<% options.forEach(function(option) { %>
- label: <%= option.label %>, value: `<%= typeof option.value === 'object' ? JSON.stringify(option.value) : option.value %>`<% }); %>

Use the **value** (not the label) when setting this field's data via `collect_field_data`.
<% } else if (formData) { %>The "fetched" value for **<%= label %>** (`data_path`: `<%= dataPath %>`) is included with following `form_data`:

<%= formData %>
<% } %>
