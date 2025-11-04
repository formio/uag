## <%= type %> fields for <%= parentLabel %>
<% if (parent) { %>
All values for these fields should be stored within the `data_path`="<%= parentDataPath %>" (e.g. "<%= parentDataPath %>.exampleField")
<% } %>

### <%= type %> fields for <%= parentLabel %>
<%= fieldList %>

<%= rules %>

Once the user provides provides some context, use the `get_field_info` tool to understand how to validate and process the data that was collected. Make sure to set the `field_paths` to only the paths of the fields that the user has provided values for.