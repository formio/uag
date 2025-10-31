<%= message %>## <%= type %> fields for <%= parentLabel %>
<% if (parent) { %>
All values for these fields should be stored within the `data_path`="<%= parentDataPath %>" (e.g. "<%= parentDataPath %>.exampleField")
<% } %>
### Summary
- Total fields for <%= parentLabel %>: <%= totalFields %>
- Number of <%=type %> fields for <%= parentLabel %>: <%= totalType %>

<%= rules %>

### <%= type %> fields for <%= parentLabel %>
<%= fieldList %>

Once the user provides provides some context, use the `get_field_info` tool to understand how to validate and process the data that was collected. Make sure to set the `field_paths` to only the paths of the fields that the user has provided values for.