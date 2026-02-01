Successfully updated the record in <%= form.title %>!
 - id: <%= submissionId %>
 - created: <%= created %>
 - modified: <%= modified %>

**Updated Fields (<%= totalFieldsUpdated %> total):**
<% updateSummary.forEach(function(update) { %>
- **<%= update.data_path %>:**
  - Previous: "<%= update.previous_value %>"
  - New: "<%= update.new_value %>"
<% }); %>

<%= dataSummary %>

All <%= totalFieldsUpdated %> field(s) have been successfully updated.