Available data for **<%= label %>** (field_path: `<%= fieldPath %>`):

<% options.forEach(function(option) { %>
- label: <%= option.label %>, value: `<%= typeof option.value === 'object' ? JSON.stringify(option.value) : option.value %>`<% }); %>

Use the **value** (not the label) when setting this field's data via `collect_field_data`.
