<%= message %>
<% if (parent) { %>
The following data is being collected for the nested component **<%= parent.label %> (<%= parent.type %>)**.  The parent `data_path` is **<%= parent.data_path %>**, and all of the child data is collected within the path of **<%= parentDataPath %>**.
<% } %>
## Progress: <%= progress.collected %>/<%= progress.total %> all fields (required and optional) collected for <%= parentLabel %>.

## Remaining required fields for <%= parentLabel %>:
<%= fields %>
Use the `collect_field_data` tool to provide values for the remaining required fields for <%= parentLabel %>. You can collect multiple fields at once by providing an array of field updates.

<%= dataSummary %>

**Next Steps**:
1. Ask the user for any remaining required fields for <%= parentLabel %>.
2. If all "required" fields have been collected, then use the `get_form_fields` with `criteria` set to "optional" to get any additional fields the user wishes to also provide.