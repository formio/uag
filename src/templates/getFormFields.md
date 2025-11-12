## <%= type %> fields for <%= parentLabel %><% if (parent) { %>

All values for these fields should be stored within the `data_path`="<%= parentDataPath %>" (e.g. "<%= parentDataPath %>.exampleField")<% } %>
<%= fieldList %>

<%= rules %>

**Next Steps**:
1. If a user has already provided values for any of these fields, use the `get_field_info` tool with the `field_paths` set to the provided fields<% if (parent) { %> along with the `parent_path`="<%= parent.data_path %>"<% } %> to determine if the values conform to the correct format and validation criteria. If so, then use the `collect_field_data` tool to collect the information already received from the user.

2. For the fields the user has not provided values, ask them if they would like to provide values for those fields. Then follow the instruction above to collect that information.