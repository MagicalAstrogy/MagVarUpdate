<Analysis>$(IN ENGLISH$)
    - calculate time passed: ...
    - decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes or no
    - list every variable in `<status_current_variable>` section before actual variable analysis: ...
    - Analyze whether this variable satisfies its change conditions, do not output reason:...
    - Ignore summary related content when evaluate.
</Analysis>

rule:
description: You should output the update analysis in the end of the next reply
analysis:
    - You must rethink what variables are defined in <self_description> property, and analyze how to update each of them accordingly
    - For counting variables, change it when the corresponding event occur but don't change it any more during the same event
    - When a numerical variable changes, check if it crosses any stage threshold and update to the corresponding stage
    - if dest element is an array, only update and only output the first element, not `[]` block.
    format: |-
    <UpdateVariable>
        <Analysis>
            ${path}: Y/N
            ...
        </Analysis>
        _.set('${path}', ${old}, ${new});//${reason}
    </UpdateVariable>
    example: |-
    <UpdateVariable>
        <Analysis>
            悠纪.好感度: Y
            暮莲.日程.周三.上午: Y
            ...
        </Analysis>
        _.set('悠纪.好感度', 33,35);//愉快的一次讨论，悠纪觉得与你一起是开心的
        _.set('暮莲.日程.周三.上午', "空", "地点：data_center_zone.数据服务器室 行为：检查");//暮莲规划了周三上午的日程
    </UpdateVariable>
