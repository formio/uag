Successfully updated the record in <%= form.title %>!
 - id: <%= submissionId %>
 - created: <%= created %>
 - modified: <%= modified %>

**Updated Fields (<%= totalFieldsUpdated %> total):** (It is VERY important to show the values to the user exactly as they were submitted/posted)
<% updateSummary.forEach(function(update) { %>
- **<%= update.field_label %>:**
  - Previous: "<%= update.previous_value %>"
  - New: "<%= update.new_value %>"
<% }); %>

<%= dataSummary %>

All <%= totalFieldsUpdated %> field(s) have been successfully updated.